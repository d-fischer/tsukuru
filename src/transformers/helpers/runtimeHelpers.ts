import * as ts from 'typescript';

/*
const __tsu = {
	cache: [],
	defineExport: function(name, def) {
		Object.defineProperty(exports, name, def);
		this.cache.push({name: name, def: def});
	},
	redefineExports: function() {
		this.cache.forEach(function(exp) {
			Object.defineProperty(exports, exp.name, exp.def);
		});
		this.cache = [];
	}
};
 */
export const createRuntimeHelpers = (factory: ts.NodeFactory, constFlag: ts.NodeFlags): ts.VariableStatement =>
	factory.createVariableStatement(
		undefined,
		factory.createVariableDeclarationList(
			[
				factory.createVariableDeclaration(
					'__tsu',
					undefined,
					undefined,
					factory.createObjectLiteralExpression(
						[
							factory.createPropertyAssignment('cache', factory.createArrayLiteralExpression([])),
							factory.createPropertyAssignment(
								'defineExport',
								factory.createFunctionExpression(
									undefined,
									undefined,
									undefined,
									undefined,
									[
										factory.createParameterDeclaration(undefined, undefined, undefined, 'name'),
										factory.createParameterDeclaration(undefined, undefined, undefined, 'def')
									],
									undefined,
									factory.createBlock(
										[
											factory.createExpressionStatement(
												factory.createCallExpression(
													factory.createPropertyAccessExpression(
														factory.createIdentifier('Object'),
														'defineProperty'
													),
													undefined,
													[
														factory.createIdentifier('exports'),
														factory.createIdentifier('name'),
														factory.createIdentifier('def')
													]
												)
											),
											factory.createExpressionStatement(
												factory.createCallExpression(
													factory.createPropertyAccessExpression(
														factory.createPropertyAccessExpression(
															factory.createIdentifier('this'),
															factory.createIdentifier('cache')
														),
														factory.createIdentifier('push')
													),
													undefined,
													[
														factory.createObjectLiteralExpression([
															factory.createPropertyAssignment(
																'name',
																factory.createIdentifier('name')
															),
															factory.createPropertyAssignment(
																'def',
																factory.createIdentifier('def')
															)
														])
													]
												)
											)
										],
										true
									)
								)
							),
							factory.createPropertyAssignment(
								'redefineExports',
								factory.createFunctionExpression(
									undefined,
									undefined,
									undefined,
									undefined,
									undefined,
									undefined,
									factory.createBlock(
										[
											factory.createExpressionStatement(
												factory.createCallExpression(
													factory.createPropertyAccessExpression(
														factory.createPropertyAccessExpression(
															factory.createIdentifier('this'),
															factory.createIdentifier('cache')
														),
														factory.createIdentifier('forEach')
													),
													undefined,
													[
														factory.createFunctionExpression(
															undefined,
															undefined,
															undefined,
															undefined,
															[
																factory.createParameterDeclaration(
																	undefined,
																	undefined,
																	undefined,
																	'exp'
																)
															],
															undefined,
															factory.createBlock(
																[
																	factory.createExpressionStatement(
																		factory.createCallExpression(
																			factory.createPropertyAccessExpression(
																				factory.createIdentifier('Object'),
																				'defineProperty'
																			),
																			undefined,
																			[
																				factory.createIdentifier('exports'),
																				factory.createPropertyAccessExpression(
																					factory.createIdentifier('exp'),
																					'name'
																				),
																				factory.createPropertyAccessExpression(
																					factory.createIdentifier('exp'),
																					'def'
																				)
																			]
																		)
																	)
																],
																true
															)
														)
													]
												)
											)
										],
										true
									)
								)
							)
						],
						true
					)
				)
			],
			constFlag
		)
	);

export const createDefineExportCall = (
	name: ts.StringLiteral,
	definition: ts.ObjectLiteralExpression,
	factory: ts.NodeFactory
): ts.ExpressionStatement =>
	factory.createExpressionStatement(
		factory.createCallExpression(
			factory.createPropertyAccessExpression(factory.createIdentifier('__tsu'), 'defineExport'),
			undefined,
			[name, definition]
		)
	);

export const createRedefineExportsCall = (factory: ts.NodeFactory): ts.ExpressionStatement =>
	factory.createExpressionStatement(
		factory.createCallExpression(
			factory.createPropertyAccessExpression(factory.createIdentifier('__tsu'), 'redefineExports'),
			undefined,
			[]
		)
	);
