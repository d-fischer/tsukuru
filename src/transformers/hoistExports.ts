import * as ts from 'typescript';

export function hoistExports(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
	const { target } = program.getCompilerOptions();
	const constFlag =
		target && target >= ts.ScriptTarget.ES2015 && target !== ts.ScriptTarget.JSON
			? ts.NodeFlags.Const
			: ts.NodeFlags.None;
	return (ctx: ts.TransformationContext) => {
		let level = 0;
		const hoisted: ts.Statement[][] = [];
		const moduleIntro: ts.Statement[][] = [];
		const levelUp = () => {
			++level;
			hoisted[level]?.splice(0, hoisted[level].length);
			moduleIntro[level]?.splice(0, moduleIntro[level].length);
		};
		const levelDown = () => --level;
		const hoistExport = (node: ts.Statement) => {
			if (hoisted[level]) {
				hoisted[level].push(node);
			} else {
				hoisted[level] = [node];
			}
		};
		const hoistModuleIntro = (node: ts.Statement, prepend: boolean = false) => {
			if (moduleIntro[level]) {
				if (prepend) {
					moduleIntro[level].unshift(node);
				} else {
					moduleIntro[level].push(node);
				}
			} else {
				moduleIntro[level] = [node];
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
			expression.kind === ts.SyntaxKind.TrueKeyword ||
			expression.kind === ts.SyntaxKind.FalseKeyword;

		/* eslint-enable no-bitwise */
		const visitor: ts.Visitor = node => {
			levelUp();

			let result = ts.visitEachChild(node, visitor, ctx);

			if (hoisted[level]?.length || moduleIntro[level]?.length) {
				const hoistedStatements = hoisted[level] ?? [];
				const hoistedModuleIntro = moduleIntro[level] ?? [];
				const others = (result as ts.Block).statements.filter(
					s => !hoistedStatements.includes(s) && !hoistedModuleIntro.includes(s)
				);
				const newResult = ts.getMutableClone(result) as ts.Block;
				newResult.statements = ts.createNodeArray([...others, ...hoistedModuleIntro, ...hoistedStatements]);
				ts.setSourceMapRange(newResult, ts.getSourceMapRange(result));

				result = newResult;
			}

			levelDown();

			if (
				ts.isExpressionStatement(result) &&
				ts.isCallExpression(result.expression) &&
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
					hoistModuleIntro(result);
					return undefined;
				}
			}

			if (
				ts.isExpressionStatement(result) &&
				ts.isBinaryExpression(result.expression) &&
				ts.isPropertyAccessExpression(result.expression.left) &&
				ts.isIdentifier(result.expression.left.expression) &&
				result.expression.left.expression.text === 'exports'
			) {
				if (result.expression.left.name.text === 'default') {
					let exportedExpression: ts.Expression;
					let creation: ts.VariableStatement | undefined;
					if (canHoistCreation(result.expression.right)) {
						exportedExpression = result.expression.right;
					} else {
						({ identifier: exportedExpression, creation } = createDefaultExportProxyConstant(
							result.expression.right
						));
						result.expression = ts.createIdentifier('__defaultExport');
					}
					const rootExport = createRootExport(exportedExpression);

					hoistModuleIntro(rootExport, true);
					hoistExport(result);

					return creation;
				} else {
					if (canHoistCreation(result.expression.right)) {
						hoistExport(result);
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

						hoistExport(exportAssignment);
						return creation;
					}
				}
			}

			return result;
		};

		return node => ts.visitNode(node, visitor);
	};
}
