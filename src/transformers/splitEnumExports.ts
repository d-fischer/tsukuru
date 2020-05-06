import * as ts from 'typescript';

export function splitEnumExports(): ts.TransformerFactory<ts.SourceFile> {
	return (ctx: ts.TransformationContext) => {
		const visitor: ts.Visitor = node => {
			if (ts.isEnumDeclaration(node) && node.modifiers) {
				const exportIndex = node.modifiers.findIndex(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
				if (exportIndex !== -1) {
					const newModifiers = [...node.modifiers];
					newModifiers.splice(exportIndex, 1);
					const enumDeclaration = ts.getMutableClone(node);
					enumDeclaration.modifiers = ts.createNodeArray(newModifiers);
					const exportDeclaration = ts.createExportDeclaration(
						undefined,
						undefined,
						ts.createNamedExports([ts.createExportSpecifier(undefined, enumDeclaration.name)])
					);
					return [enumDeclaration, exportDeclaration];
				}
			}
			return ts.visitEachChild(node, visitor, ctx);
		};
		return node => ts.visitNode(node, visitor);
	};
}
