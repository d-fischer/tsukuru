import * as ora from 'ora';
import * as path from 'path';
import * as ts from 'typescript';
import { promisify } from 'util';
import { hoistExports } from './transformers/hoistExports';
import { resolveModulePaths } from './transformers/resolveModulePaths';
import { splitEnumExports } from './transformers/splitEnumExports';
import { exit } from './util';
import * as _rimraf from 'rimraf';

const rimraf = promisify(_rimraf);

export interface WrapperOptions {
	useCjsTransformers?: boolean;
	shouldClean?: boolean;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], host: ts.CompilerHost) {
	const shouldBePretty = !!ts.sys.writeOutputIsTTY?.();
	const formatHost: ts.FormatDiagnosticsHost = {
		getCanonicalFileName(fileName: string) {
			return host.getCanonicalFileName(fileName);
		},
		getCurrentDirectory() {
			return host.getCurrentDirectory();
		},
		getNewLine() {
			return host.getNewLine();
		}
	};
	if (shouldBePretty) {
		return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
	}
	return ts.formatDiagnostics(diagnostics, formatHost);
}

function handleDiagnostics(
	diagnostics: readonly ts.Diagnostic[],
	host: ts.CompilerHost,
	errorPrefix = 'Unknown error'
) {
	if (diagnostics.length) {
		process.stderr.write('\n\n');
		console.error(formatDiagnostics(diagnostics, host));
		console.error(`${errorPrefix}. Exiting.`);
		exit(1);
	}
}

function handleConfigParsingErrors(parsedCommandLine: ts.ParsedCommandLine | undefined, host: ts.CompilerHost) {
	if (parsedCommandLine && parsedCommandLine.errors.length) {
		process.stderr.write('\n\n');
		console.error(formatDiagnostics(parsedCommandLine.errors, host));
		exit(1);
	}
	if (!parsedCommandLine) {
		process.stderr.write('\n\n');
		console.error('Unknown error parsing config.');
		exit(1);
	}
}

function parseConfig(configFilePath: string) {
	const tempCompilerHost = ts.createCompilerHost({}, false);
	// from here https://github.com/Microsoft/TypeScript/blob/6fb0f6818ad48bf4f685e86c03405ddc84b530ed/src/compiler/program.ts#L2812
	const configParsingHost: ts.ParseConfigFileHost = {
		fileExists: f => tempCompilerHost.fileExists(f),
		readDirectory: (root, extensions, includes, depth?) =>
			tempCompilerHost.readDirectory ? tempCompilerHost.readDirectory(root, extensions, includes, depth) : [],
		readFile: f => tempCompilerHost.readFile(f),
		useCaseSensitiveFileNames: tempCompilerHost.useCaseSensitiveFileNames(),
		getCurrentDirectory: () => tempCompilerHost.getCurrentDirectory(),
		onUnRecoverableConfigFileDiagnostic: () => undefined
	};
	const parsedConfig = ts.getParsedCommandLineOfConfigFile(
		configFilePath,
		{},
		{
			...configParsingHost,
			onUnRecoverableConfigFileDiagnostic(d) {
				handleDiagnostics([d], tempCompilerHost);
			}
		}
	)!;

	handleConfigParsingErrors(parsedConfig, tempCompilerHost);

	return parsedConfig;
}

interface OraHack {
	throbber?: ora.Ora;
	nextFrameTime: number;
}

export async function compile(configFilePath: string, { useCjsTransformers, shouldClean }: WrapperOptions) {
	const renderHackCancellationToken: ts.CancellationToken & OraHack = {
		throbber: undefined,
		nextFrameTime: Date.now(),
		isCancellationRequested() {
			if (this.throbber) {
				const now = Date.now();
				if (now >= this.nextFrameTime) {
					this.throbber.render();
					this.nextFrameTime = now + ((this.throbber.spinner as ora.Spinner).interval ?? 100);
				}
			}
			return false;
		},
		throwIfCancellationRequested() {
			this.isCancellationRequested();
			// nah never throwing
		}
	};
	function step(name: string, worker: () => void) {
		const throbber = ora({ text: `${name}... `, color: 'blue' });
		throbber.render();
		renderHackCancellationToken.throbber = throbber;
		const start = Date.now();
		worker();
		throbber.succeed(`${name} (${Date.now() - start}ms)`);
		renderHackCancellationToken.throbber = undefined;
	}

	async function stepAsync(name: string, worker: () => Promise<void>) {
		const throbber = ora({ text: `${name}... `, color: 'blue' }).start();
		const start = Date.now();
		await worker();
		throbber.succeed(`${name} (${Date.now() - start}ms)`);
	}

	const parsedConfig = parseConfig(configFilePath);

	if (!parsedConfig.options.isolatedModules) {
		console.error(
			`This tool depends on the isolatedModules option. Please enable it in your ${path.basename(
				configFilePath
			)} file.`
		);
		return 1;
	}

	if (shouldClean) {
		await stepAsync('Cleaning up', async () => {
			const configDir = path.dirname(configFilePath);
			const { outDir } = parsedConfig.options;
			if (outDir) {
				await rimraf(path.resolve(configDir, outDir));
			}
			await rimraf(path.join(configDir, 'es'));
		});
	}

	const { options, fileNames } = parsedConfig;

	let cjsCompilerHost!: ts.CompilerHost;
	let cjsProgram!: ts.Program;
	step('Creating CommonJS compiler instance', () => {
		cjsCompilerHost = ts.createCompilerHost(options);
		cjsProgram = ts.createProgram({
			options,
			configFileParsingDiagnostics: parsedConfig.errors,
			rootNames: fileNames,
			host: cjsCompilerHost
		});
	});

	step('Checking for syntax and type errors', () => {
		const preEmitDiagnostics = ts.getPreEmitDiagnostics(cjsProgram, undefined, renderHackCancellationToken);
		handleDiagnostics(preEmitDiagnostics, cjsCompilerHost, 'Found syntax or type errors');
	});

	step('Emitting CommonJS modules', () => {
		const cjsEmitResult = cjsProgram.emit(
			undefined,
			undefined,
			renderHackCancellationToken,
			undefined,
			useCjsTransformers
				? {
						before: [splitEnumExports()],
						after: [hoistExports(cjsProgram)],
						afterDeclarations: []
				  }
				: undefined
		);
		handleDiagnostics(cjsEmitResult.diagnostics, cjsCompilerHost, 'Error emitting CommonJS');
	});

	// HACK: there's no API for this so we have to monkey patch a private TS API
	// @ts-ignore
	const origOutputPath = ts.getOwnEmitOutputFilePath;
	// @ts-ignore
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ts.getOwnEmitOutputFilePath = function getOwnEmitOutputFilePath(fileName: string, host: any, extension: string) {
		const newExtension = extension === '.js' ? '.mjs' : extension;
		return origOutputPath(fileName, host, newExtension);
	};

	let esmCompilerHost!: ts.CompilerHost;
	let esmProgram!: ts.Program;
	step('Creating ESM compiler instance', () => {
		const esmOptions = {
			...options,
			outDir: 'es',
			module: ts.ModuleKind.ESNext,
			// double declarations are not necessary
			declaration: false,
			// avoid type checks at all costs
			noResolve: true,
			noLib: true
		};
		esmCompilerHost = ts.createCompilerHost(esmOptions);
		esmProgram = ts.createProgram({
			options: esmOptions,
			configFileParsingDiagnostics: parsedConfig.errors,
			rootNames: fileNames,
			host: esmCompilerHost
		});
	});

	step('Emitting ES Modules', () => {
		const esmEmitResult = esmProgram.emit(undefined, undefined, renderHackCancellationToken, undefined, {
			before: [],
			after: [resolveModulePaths()],
			afterDeclarations: []
		});
		handleDiagnostics(esmEmitResult.diagnostics, esmCompilerHost, 'Error emitting ESM');
	});

	// @ts-ignore
	ts.getOwnEmitOutputFilePath = origOutputPath;

	return 0;
}
