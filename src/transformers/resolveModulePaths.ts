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
						const newNode = ts.getMutableClone(node);
						if (ts.isImportDeclaration(newNode) || ts.isExportDeclaration(newNode)) {
							newNode.moduleSpecifier = ts.createLiteral(transformedPath);
						} else if (isDynamicImport(newNode)) {
							newNode.arguments = ts.createNodeArray([ts.createStringLiteral(transformedPath)]);
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
