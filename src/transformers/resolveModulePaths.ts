import * as path from 'path';
import * as ts from 'typescript';

function isDynamicImport(node: ts.Node): node is ts.CallExpression {
	return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function fileExists(fileName: string): boolean {
	return ts.sys.fileExists(fileName);
}

function readFile(fileName: string): string | undefined {
	return ts.sys.readFile(fileName);
}

export function resolveModulePaths(): ts.TransformerFactory<ts.SourceFile> {
	return (ctx: ts.TransformationContext) => {
		const { factory } = ctx;
		const visitor: ts.Visitor = node => {
			let importPath: string | undefined;
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				importPath = node.moduleSpecifier.text;
			} else if (isDynamicImport(node)) {
				const importArg = node.arguments[0];
				if (ts.isStringLiteral(importArg)) {
					importPath = importArg.text;
				}
			}

			if (importPath) {
				if (importPath.startsWith('./') || importPath.startsWith('../')) {
					let transformedPath = importPath;
					let sourceFile: ts.SourceFile | undefined = node.getSourceFile();
					if (!sourceFile && (ts.isExportDeclaration(node) || ts.isImportDeclaration(node))) {
						sourceFile = node.moduleSpecifier?.getSourceFile();
					}
					if (sourceFile) {
						const result = ts.resolveModuleName(importPath, sourceFile.fileName, ctx.getCompilerOptions(), {
							fileExists,
							readFile
						});
						if (result.resolvedModule) {
							transformedPath = path.posix.relative(
								path.dirname(sourceFile.fileName),
								result.resolvedModule.resolvedFileName
							);
							transformedPath =
								transformedPath.startsWith('./') || transformedPath.startsWith('../')
									? transformedPath
									: `./${transformedPath}`;
							transformedPath = transformedPath.replace(/\.ts$/, '.mjs');
						}
					}
					if (transformedPath !== importPath) {
						let newNode: ts.Node;
						if (ts.isImportDeclaration(node)) {
							newNode = factory.createImportDeclaration(
								node.decorators,
								node.modifiers,
								node.importClause,
								factory.createStringLiteral(transformedPath)
							);
						} else if (ts.isExportDeclaration(node)) {
							newNode = factory.createExportDeclaration(
								node.decorators,
								node.modifiers,
								node.isTypeOnly,
								node.exportClause,
								factory.createStringLiteral(transformedPath)
							);
						} else if (isDynamicImport(node)) {
							newNode = factory.createCallExpression(factory.createIdentifier('import'), undefined, [
								factory.createStringLiteral(transformedPath)
							]);
						} else {
							newNode = node;
						}

						ts.setSourceMapRange(newNode, ts.getSourceMapRange(node));

						return newNode;
					}
				}
			}
			return ts.visitEachChild(node, visitor, ctx);
		};

		return node => ts.visitNode(node, visitor);
	};
}
