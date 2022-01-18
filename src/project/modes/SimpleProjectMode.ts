import * as path from 'path';
import * as _rimraf from 'rimraf';
import * as ts from 'typescript';
import { promisify } from 'util';
import { exit, handleDiagnostics } from '../../util';
import { hoistExports } from '../transformers/hoistExports';
import { resolveModulePaths } from '../transformers/resolveModulePaths';
import { splitEnumExports } from '../transformers/splitEnumExports';
import type { ProjectMode } from './ProjectMode';

const rimraf = promisify(_rimraf);

export class SimpleProjectMode implements ProjectMode {
	private _cjsCompilerHost?: ts.CompilerHost;
	private _cjsProgram?: ts.Program;

	private _esmCompilerHost?: ts.CompilerHost;
	private _esmProgram?: ts.Program;

	constructor(
		private readonly _configFilePath: string,
		private readonly _config: ts.ParsedCommandLine,
		private readonly _cancellationToken: ts.CancellationToken
	) {}

	checkRequirements(): void {
		if (!this._config.options.isolatedModules) {
			console.error(
				`This tool depends on the isolatedModules option. Please enable it in your ${path.basename(
					this._configFilePath
				)} file.`
			);
			exit(1);
		}
	}

	initCommonJs(): void {
		if (this._cjsCompilerHost || this._cjsProgram) {
			throw new Error('invalid state: CJS host/program already initialized');
		}
		this._cjsCompilerHost = ts.createCompilerHost(this._config.options);
		this._cjsProgram = ts.createProgram({
			options: this._config.options,
			configFileParsingDiagnostics: this._config.errors,
			rootNames: this._config.fileNames,
			host: this._cjsCompilerHost
		});
	}

	checkTsErrors(): void {
		if (!this._cjsCompilerHost || !this._cjsProgram) {
			throw new Error('invalid state: CJS host/program not initialized');
		}
		const preEmitDiagnostics = ts.getPreEmitDiagnostics(this._cjsProgram, undefined, this._cancellationToken);
		handleDiagnostics(preEmitDiagnostics, this._cjsCompilerHost, 'Found syntax or type errors');
	}

	async cleanCommonJs(): Promise<void> {
		const configDir = path.dirname(this._configFilePath);
		const { outDir } = this._config.options;
		if (outDir) {
			await rimraf(path.resolve(configDir, outDir));
		}
	}

	emitCommonJs(useTransformers: boolean): void {
		if (!this._cjsCompilerHost || !this._cjsProgram) {
			throw new Error('invalid state: CJS host/program not initialized');
		}
		const cjsEmitResult = this._cjsProgram.emit(
			undefined,
			undefined,
			this._cancellationToken,
			undefined,
			useTransformers
				? {
						before: [splitEnumExports()],
						after: [hoistExports(this._cjsProgram)],
						afterDeclarations: []
				  }
				: undefined
		);
		handleDiagnostics(cjsEmitResult.diagnostics, this._cjsCompilerHost, 'Error emitting CommonJS');
	}

	initEsm(): void {
		if (this._esmCompilerHost || this._esmProgram) {
			throw new Error('invalid state: ESM host/program already initialized');
		}

		const esmOptions = {
			...this._config.options,
			outDir: 'es',
			module: ts.ModuleKind.ESNext,
			// double declarations are not necessary
			declaration: false,
			// avoid type checks at all costs
			noResolve: true,
			noLib: true
		};
		this._esmCompilerHost = ts.createCompilerHost(esmOptions);
		this._esmProgram = ts.createProgram({
			options: esmOptions,
			configFileParsingDiagnostics: this._config.errors,
			rootNames: this._config.fileNames,
			host: this._esmCompilerHost
		});
	}

	async cleanEsm(): Promise<void> {
		const configDir = path.dirname(this._configFilePath);
		await rimraf(path.join(configDir, 'es'));
	}

	emitEsm(): void {
		if (!this._esmCompilerHost || !this._esmProgram) {
			throw new Error('invalid state: ESM host/program not initialized');
		}
		// HACK: there's no API for this so we have to monkey patch a private TS  aPI
		/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
		const origOutputPath: (fileName: string, host: unknown, extension: string) => string = (ts as any)
			.getOwnEmitOutputFilePath;
		(ts as any).getOwnEmitOutputFilePath = function getOwnEmitOutputFilePath(
			fileName: string,
			host: unknown,
			extension: string
		) {
			const newExtension = extension === '.js' ? '.mjs' : extension;
			return origOutputPath(fileName, host, newExtension);
		};
		const esmEmitResult = this._esmProgram.emit(undefined, undefined, this._cancellationToken, undefined, {
			before: [],
			after: [resolveModulePaths()],
			afterDeclarations: []
		});
		handleDiagnostics(esmEmitResult.diagnostics, this._esmCompilerHost, 'Error emitting ESM');

		(ts as any).getOwnEmitOutputFilePath = origOutputPath;
		/* eslint-enable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
	}
}
