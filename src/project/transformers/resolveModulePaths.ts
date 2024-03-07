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

function transformImportExportNodePath(factory: ts.NodeFactory, node: ts.Node, transformedPath: string) {
	if (ts.isImportDeclaration(node)) {
		return factory.createImportDeclaration(
			node.modifiers,
			node.importClause,
			factory.createStringLiteral(transformedPath)
		);
	}

	if (ts.isExportDeclaration(node)) {
		return factory.createExportDeclaration(
			node.modifiers,
			node.isTypeOnly,
			node.exportClause,
			factory.createStringLiteral(transformedPath)
		);
	}

	if (isDynamicImport(node)) {
		return factory.createCallExpression(factory.createIdentifier('import'), undefined, [
			factory.createStringLiteral(transformedPath)
		]);
	}

	return node;
}

function getNodeImportPath(node: ts.Node) {
	if (
		(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
		node.moduleSpecifier &&
		ts.isStringLiteral(node.moduleSpecifier)
	) {
		return node.moduleSpecifier.text;
	}

	if (isDynamicImport(node)) {
		const [importArg] = node.arguments;
		if (ts.isStringLiteral(importArg)) {
			return importArg.text;
		}
	}

	return undefined;
}

export function resolveModulePaths(): ts.TransformerFactory<ts.SourceFile> {
	return (ctx: ts.TransformationContext) => {
		const { factory } = ctx;
		const visitor: ts.Visitor = node => {
			const importPath = getNodeImportPath(node);

			if (importPath) {
				if (importPath.startsWith('./') || importPath.startsWith('../')) {
					let transformedPath = importPath;
					let sourceFile: ts.SourceFile | undefined = node.getSourceFile();
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
						const newNode = transformImportExportNodePath(factory, node, transformedPath);

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
