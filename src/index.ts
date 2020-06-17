import * as ts from 'typescript';
import { hoistExports } from './transformers/hoistExports';
import { resolveModulePaths } from './transformers/resolveModulePaths';
import { splitEnumExports } from './transformers/splitEnumExports';
import { createGetCanonicalFileName } from './util';

export interface WrapperOptions {
	useCjsTransformers?: boolean;
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

export function compile(parsedCmd: ts.ParsedCommandLine, { useCjsTransformers }: WrapperOptions) {
	const { options, fileNames } = parsedCmd;

	let anyDiagnostics = false;

	console.log('[CJS] Compiling...');

	const cjsProgram = ts.createProgram({
		rootNames: fileNames,
		options
	});

	const cjsEmitResult = cjsProgram.emit(
		undefined,
		undefined,
		undefined,
		undefined,
		useCjsTransformers
			? {
					before: [splitEnumExports()],
					after: [hoistExports(cjsProgram)],
					afterDeclarations: []
			  }
			: undefined
	);

	ts.getPreEmitDiagnostics(cjsProgram)
		.concat(cjsEmitResult.diagnostics)
		.forEach(diagnostic => {
			anyDiagnostics = true;
			let msg = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			if (diagnostic.file) {
				const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
				msg = `[CJS] ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${msg}`;
			}
			console.error(msg);
		});

	const cjsExitCode = cjsEmitResult.emitSkipped ? 1 : 0;

	console.log('[ESM] Compiling...');

	// HACK: there's no API for this so we have to monkey patch a private TS API
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
		after: [resolveModulePaths()],
		afterDeclarations: []
	});

	ts.getPreEmitDiagnostics(esmProgram)
		.concat(esmEmitResult.diagnostics)
		.forEach(diagnostic => {
			anyDiagnostics = true;
			let msg = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			if (diagnostic.file) {
				const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
				msg = `[ESM] ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${msg}`;
			}
			console.error(msg);
		});

	const esmExitCode = esmEmitResult.emitSkipped ? 1 : 0;

	// @ts-ignore
	ts.getOwnEmitOutputFilePath = origOutputPath;

	return cjsExitCode || esmExitCode || (anyDiagnostics ? 2 : 0);
}
