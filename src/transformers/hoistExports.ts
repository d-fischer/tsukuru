import * as ts from 'typescript';

export function hoistExports(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
	const { target } = program.getCompilerOptions();
	const constFlag =
		target && target >= ts.ScriptTarget.ES2015 && target !== ts.ScriptTarget.JSON
			? ts.NodeFlags.Const
			: ts.NodeFlags.None;
	return (ctx: ts.TransformationContext) => {
		let level = 0;
		const exportsByLevel: ts.Statement[][] = [];
		const moduleIntroByLevel: ts.Statement[][] = [];
		const levelUp = () => {
			++level;
			exportsByLevel[level]?.splice(0, exportsByLevel[level].length);
			moduleIntroByLevel[level]?.splice(0, moduleIntroByLevel[level].length);
		};
		const levelDown = () => --level;
		const addExport = (node: ts.Statement) => {
			if (exportsByLevel[level]) {
				exportsByLevel[level].push(node);
			} else {
				exportsByLevel[level] = [node];
			}
		};
		const addModuleIntro = (node: ts.Statement, prepend: boolean = false) => {
			if (moduleIntroByLevel[level]) {
				if (prepend) {
					moduleIntroByLevel[level].unshift(node);
				} else {
					moduleIntroByLevel[level].push(node);
				}
			} else {
				moduleIntroByLevel[level] = [node];
			}
		};

		const createRootExport = (identifier: ts.Expression) =>
			ts.createExpressionStatement(
				ts.createBinary(
					ts.createPropertyAccess(ts.createIdentifier('module'), ts.createIdentifier('exports')),
					ts.createToken(ts.SyntaxKind.EqualsToken),
					ts.createBinary(
						ts.createIdentifier('exports'),
						ts.createToken(ts.SyntaxKind.EqualsToken),
						identifier
					)
				)
			);

		const createDefaultExportProxyConstant = (expr: ts.Expression) => ({
			identifier: ts.createIdentifier('__defaultExport'),
			creation: ts.createVariableStatement(
				undefined,
				ts.createVariableDeclarationList(
					[ts.createVariableDeclaration(ts.createIdentifier('__defaultExport'), undefined, expr)],
					constFlag
				)
			)
		});

		const canHoistCreation = (expression: ts.Expression): boolean =>
			ts.isIdentifier(expression) ||
			ts.isLiteralExpression(expression) ||
			(ts.isPropertyAccessExpression(expression) &&
				ts.isIdentifier(expression.expression) &&
				ts.isIdentifier(expression.name)) ||
			expression.kind === ts.SyntaxKind.TrueKeyword ||
			expression.kind === ts.SyntaxKind.FalseKeyword;

		const sourceFileHasDefaultExport = (file: ts.SourceFile): boolean =>
			file.statements.some(
				node =>
					ts.isExpressionStatement(node) &&
					ts.isBinaryExpression(node.expression) &&
					ts.isPropertyAccessExpression(node.expression.left) &&
					ts.isIdentifier(node.expression.left.expression) &&
					node.expression.left.expression.text === 'exports' &&
					node.expression.left.name.text === 'default'
			);

		const visitor: ts.Visitor = node => {
			levelUp();

			let result = node;
			if (ts.isSourceFile(node)) {
				if (sourceFileHasDefaultExport(node)) {
					result = ts.visitEachChild(node, visitor, ctx);

					if (exportsByLevel[level]?.length || moduleIntroByLevel[level]?.length) {
						const addedExports = exportsByLevel[level] ?? [];
						const addedModuleIntro = moduleIntroByLevel[level] ?? [];
						const newResult = ts.getMutableClone(result) as ts.Block;
						newResult.statements = ts.createNodeArray([
							...(result as ts.Block).statements,
							...addedModuleIntro,
							...addedExports
						]);
						ts.setSourceMapRange(newResult, ts.getSourceMapRange(result));

						result = newResult;
					}
				}
			} else {
				result = ts.visitEachChild(node, visitor, ctx);
			}

			levelDown();

			if (ts.isExpressionStatement(result)) {
				if (ts.isCallExpression(result.expression)) {
					if (
						ts.isPropertyAccessExpression(result.expression.expression) &&
						ts.isIdentifier(result.expression.expression.expression) &&
						result.expression.expression.expression.text === 'Object' &&
						ts.isIdentifier(result.expression.expression.name) &&
						result.expression.expression.name.text === 'defineProperty'
					) {
						const [exportsArg, nameArg] = result.expression.arguments;
						if (
							ts.isIdentifier(exportsArg) &&
							exportsArg.text === 'exports' &&
							ts.isStringLiteral(nameArg) &&
							nameArg.text === '__esModule'
						) {
							addModuleIntro(ts.getMutableClone(result));
						}
					}
				} else if (
					ts.isBinaryExpression(result.expression) &&
					ts.isPropertyAccessExpression(result.expression.left) &&
					ts.isIdentifier(result.expression.left.expression) &&
					result.expression.left.expression.text === 'exports'
				) {
					if (result.expression.left.name.text === 'default') {
						let exportedExpression: ts.Expression;
						let creation: ts.VariableStatement | undefined;
						let defaultExport = result;
						if (canHoistCreation(result.expression.right)) {
							exportedExpression = result.expression.right;
						} else {
							({ identifier: exportedExpression, creation } = createDefaultExportProxyConstant(
								result.expression.right
							));
							defaultExport = ts.getMutableClone(result);
							(defaultExport.expression as ts.AssignmentExpression<
								ts.AssignmentOperatorToken
							>).right = ts.createIdentifier('__defaultExport');
						}
						const rootExport = createRootExport(exportedExpression);

						addModuleIntro(rootExport, true);
						addExport(defaultExport);

						return creation ? [creation, defaultExport] : defaultExport;
					} else {
						if (canHoistCreation(result.expression.right)) {
							addExport(result);
						} else {
							const tmpIdentifier = ts.createIdentifier(`__export_${result.expression.left.name.text}`);
							const creation = ts.createVariableStatement(
								undefined,
								ts.createVariableDeclarationList(
									[ts.createVariableDeclaration(tmpIdentifier, undefined, result.expression.right)],
									constFlag
								)
							);
							const exportAssignment = ts.createExpressionStatement(
								ts.createBinary(
									result.expression.left,
									ts.createToken(ts.SyntaxKind.EqualsToken),
									tmpIdentifier
								)
							);

							addExport(exportAssignment);
							return [creation, exportAssignment];
						}
					}
				}
			}

			return result;
		};

		return node => ts.visitNode(node, visitor);
	};
}
