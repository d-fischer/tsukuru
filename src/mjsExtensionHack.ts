import * as ts from 'typescript';

export function withMjsExtensionHack(fn: () => void): void {
	// HACK: there's no API for this so we have to monkey patch a private TS  aPI
	/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
	const origOutputPath: (fileName: string, host: unknown, extension: string) => string = ts.getOwnEmitOutputFilePath;
	(ts as any).getOwnEmitOutputFilePath = function getOwnEmitOutputFilePath(
		fileName: string,
		host: unknown,
		extension: string
	) {
		const newExtension = extension === '.js' ? '.mjs' : extension;
		return origOutputPath(fileName, host, newExtension);
	};

	fn();

	(ts as any).getOwnEmitOutputFilePath = origOutputPath;
	/* eslint-enable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
}
