import * as ts from 'typescript';
import { createDefineExportCall, createRedefineExportsCall, createRuntimeHelpers } from './helpers/runtimeHelpers';

export function hoistExports(): ts.TransformerFactory<ts.SourceFile> {
	return (ctx: ts.TransformationContext) => {
		const { factory } = ctx;
		const { target } = ctx.getCompilerOptions();
		const constFlag =
			target && target >= ts.ScriptTarget.ES2015 && target !== ts.ScriptTarget.JSON
				? ts.NodeFlags.Const
				: ts.NodeFlags.None;

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
			factory.createExpressionStatement(
				factory.createBinaryExpression(
					factory.createPropertyAccessExpression(
						factory.createIdentifier('module'),
						factory.createIdentifier('exports')
					),
					factory.createToken(ts.SyntaxKind.EqualsToken),
					factory.createBinaryExpression(
						factory.createIdentifier('exports'),
						factory.createToken(ts.SyntaxKind.EqualsToken),
						identifier
					)
				)
			);

		const createDefaultExportProxyConstant = (expr: ts.Expression) => ({
			identifier: factory.createIdentifier('__defaultExport'),
			creation: factory.createVariableStatement(
				undefined,
				factory.createVariableDeclarationList(
					[
						factory.createVariableDeclaration(
							factory.createIdentifier('__defaultExport'),
							undefined,
							undefined,
							expr
						)
					],
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

		const isVoidExportInitializer = (expression: ts.Expression): boolean =>
			ts.isBinaryExpression(expression) &&
			ts.isPropertyAccessExpression(expression.left) &&
			ts.isIdentifier(expression.left.expression) &&
			expression.left.expression.text === 'exports' &&
			((ts.isVoidExpression(expression.right) &&
				ts.isNumericLiteral(expression.right.expression) &&
				expression.right.expression.text === '0') ||
				isVoidExportInitializer(expression.right));

		const visitor: ts.Visitor = node => {
			levelUp();

			let result = node;
			if (ts.isSourceFile(node)) {
				if (sourceFileHasDefaultExport(node)) {
					result = ts.visitEachChild(node, visitor, ctx);

					if (exportsByLevel[level]?.length || moduleIntroByLevel[level]?.length) {
						const addedExports = exportsByLevel[level] ?? [];
						const addedModuleIntro = moduleIntroByLevel[level] ?? [];
						let index = 0;
						const wrapperVisitor: ts.Visitor = _node => {
							const currentIndex = index++;
							if (currentIndex === 0) {
								return [createRuntimeHelpers(factory, constFlag), _node];
							} else if (currentIndex === (result as ts.SourceFile).statements.length - 1) {
								return [
									_node,
									...addedModuleIntro,
									createRedefineExportsCall(factory),
									...addedExports
								];
							}
							return _node;
						};
						const newResult = ts.visitEachChild(result, wrapperVisitor, ctx);
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
						const [exportsArg, nameArg, definitionArg] = result.expression.arguments;
						if (
							ts.isIdentifier(exportsArg) &&
							exportsArg.text === 'exports' &&
							ts.isStringLiteral(nameArg)
						) {
							if (nameArg.text === '__esModule') {
								addModuleIntro(factory.createExpressionStatement(result.expression));
							} else if (ts.isObjectLiteralExpression(definitionArg)) {
								return createDefineExportCall(nameArg, definitionArg, factory);
							}
						}
					}
				} else if (
					ts.isBinaryExpression(result.expression) &&
					ts.isPropertyAccessExpression(result.expression.left) &&
					ts.isIdentifier(result.expression.left.expression) &&
					result.expression.left.expression.text === 'exports'
				) {
					if (result.expression.left.name.text === 'default') {
						// eslint-disable-next-line @typescript-eslint/init-declarations
						let exportedExpression: ts.Expression;
						// eslint-disable-next-line @typescript-eslint/init-declarations
						let creation: ts.VariableStatement | undefined;
						let defaultExport = result;
						if (canHoistCreation(result.expression.right)) {
							exportedExpression = result.expression.right;
						} else {
							({ identifier: exportedExpression, creation } = createDefaultExportProxyConstant(
								result.expression.right
							));
							defaultExport = factory.createExpressionStatement(
								factory.createAssignment(
									result.expression.left,
									factory.createIdentifier('__defaultExport')
								)
							);
						}
						const rootExport = createRootExport(exportedExpression);

						addModuleIntro(rootExport, true);
						addExport(defaultExport);

						return creation ? [creation, defaultExport] : defaultExport;
					} else if (!isVoidExportInitializer(result.expression)) {
						if (canHoistCreation(result.expression.right)) {
							addExport(result);
						} else {
							const tmpIdentifier = factory.createIdentifier(
								`__export_${result.expression.left.name.text}`
							);
							const creation = factory.createVariableStatement(
								undefined,
								factory.createVariableDeclarationList(
									[
										factory.createVariableDeclaration(
											tmpIdentifier,
											undefined,
											undefined,
											result.expression.right
										)
									],
									constFlag
								)
							);
							const exportAssignment = factory.createExpressionStatement(
								factory.createBinaryExpression(
									result.expression.left,
									factory.createToken(ts.SyntaxKind.EqualsToken),
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
