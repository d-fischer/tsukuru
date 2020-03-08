import * as ts from 'typescript';
import { transform } from './esm-transformer';
import { createGetCanonicalFileName, exit } from './util';

declare module 'typescript' {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getOwnEmitOutputFilePath(fileName: string, host: any, extension: string): string;
}

const sysFormatDiagnosticsHost = {
	getCurrentDirectory: function() {
		return ts.sys.getCurrentDirectory();
	},
	getNewLine: function() {
		return ts.sys.newLine;
	},
	getCanonicalFileName: createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames)
};

function createDiagnosticReporter(system: ts.System, pretty?: boolean) {
	const host =
		system === ts.sys
			? sysFormatDiagnosticsHost
			: {
					getCurrentDirectory: function() {
						return system.getCurrentDirectory();
					},
					getNewLine: function() {
						return system.newLine;
					},
					getCanonicalFileName: createGetCanonicalFileName(system.useCaseSensitiveFileNames)
			  };
	if (!pretty) {
		return function(diagnostic: ts.Diagnostic) {
			return system.write(ts.formatDiagnostic(diagnostic, host));
		};
	}
	const diagnostics = new Array(1);
	return (diagnostic: ts.Diagnostic) => {
		diagnostics[0] = diagnostic;
		system.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, host) + host.getNewLine());
		diagnostics[0] = undefined;
	};
}

export function parseCmdLine(configFilePath: string) {
	const reportDiagnostic = createDiagnosticReporter(ts.sys);
	const configHost: ts.ParseConfigFileHost = {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: reportDiagnostic
	};
	return ts.getParsedCommandLineOfConfigFile(configFilePath, {}, configHost)!;
}

export function compile(parsedCmd: ts.ParsedCommandLine) {
	const { options, fileNames } = parsedCmd;

	console.log('[CJS] Compiling...');

	const cjsProgram = ts.createProgram({
		rootNames: fileNames,
		options
	});

	const cjsEmitResult = cjsProgram.emit(undefined, undefined, undefined, undefined, {
		before: [],
		after: [],
		afterDeclarations: []
	});

	ts.getPreEmitDiagnostics(cjsProgram)
		.concat(cjsEmitResult.diagnostics)
		.forEach(diagnostic => {
			let msg = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			if (diagnostic.file) {
				const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
				msg = `[CJS] ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${msg}`;
			}
			console.error(msg);
		});

	const cjsExitCode = cjsEmitResult.emitSkipped ? 1 : 0;
	if (cjsExitCode) {
		exit(cjsExitCode);
	}

	console.log('[ESM] Compiling...');

	// @ts-ignore
	const origOutputPath = ts.getOwnEmitOutputFilePath;
	// @ts-ignore
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ts.getOwnEmitOutputFilePath = function getOwnEmitOutputFilePath(fileName: string, host: any, extension: string) {
		const newExtension = extension === '.js' ? '.mjs' : extension;
		return origOutputPath(fileName, host, newExtension);
	};

	const esmProgram = ts.createProgram({
		rootNames: fileNames,
		options: {
			...options,
			outDir: 'es',
			module: ts.ModuleKind.ESNext,
			// tslib is currently not compatible with native ESM
			importHelpers: false,
			// double declarations are not necessary
			declaration: false
		}
	});

	const esmEmitResult = esmProgram.emit(undefined, undefined, undefined, undefined, {
		before: [],
		after: [transform()],
		afterDeclarations: []
	});

	ts.getPreEmitDiagnostics(esmProgram)
		.concat(esmEmitResult.diagnostics)
		.forEach(diagnostic => {
			let msg = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			if (diagnostic.file) {
				const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
				msg = `[ESM] ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${msg}`;
			}
			console.error(msg);
		});

	const esmExitCode = esmEmitResult.emitSkipped ? 1 : 0;
	if (esmExitCode) {
		exit(esmExitCode);
	}

	// @ts-ignore
	ts.getOwnEmitOutputFilePath = origOutputPath;
}
