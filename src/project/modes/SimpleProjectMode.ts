import * as fs from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { renameOutputFilesToMjs } from '../../mjsRename';
import { exit, handleDiagnostics } from '../../util';
import type { WrapperOptions } from '../compile';
import { hoistExports } from '../transformers/hoistExports';
import { resolveModulePaths } from '../transformers/resolveModulePaths';
import { splitEnumExports } from '../transformers/splitEnumExports';
import type { ProjectMode } from './ProjectMode';

export class SimpleProjectMode implements ProjectMode {
	private _cjsCompilerHost?: ts.CompilerHost;
	private _cjsProgram?: ts.Program;

	private _esmCompilerHost?: ts.CompilerHost;
	private _esmProgram?: ts.Program;

	constructor(
		private readonly _config: WrapperOptions,
		private readonly _tsConfigFilePath: string,
		private readonly _tsConfig: ts.ParsedCommandLine,
		private readonly _cancellationToken: ts.CancellationToken
	) {}

	checkRequirements(): void {
		if (!this._tsConfig.options.isolatedModules) {
			console.error(
				`This tool depends on the isolatedModules option. Please enable it in your ${path.basename(
					this._tsConfigFilePath
				)} file.`
			);
			exit(1);
		}
	}

	async cleanAndInitCommonJs(overrideOptions?: Partial<ts.CompilerOptions>): Promise<void> {
		if (this._cjsCompilerHost ?? this._cjsProgram) {
			throw new Error('invalid state: CJS host/program already initialized');
		}
		if (this._config.shouldClean) {
			await this._cleanCommonJs();
		}
		this._cjsCompilerHost = ts.createCompilerHost(this._tsConfig.options);
		this._cjsCompilerHost.useSourceOfProjectReferenceRedirect = () => true;
		this._cjsProgram = ts.createProgram({
			options: { ...this._tsConfig.options, ...overrideOptions },
			configFileParsingDiagnostics: this._tsConfig.errors,
			rootNames: this._tsConfig.fileNames,
			host: this._cjsCompilerHost,
			projectReferences: this._tsConfig.projectReferences
		});
	}

	checkTsErrors(): void {
		if (!this._cjsCompilerHost || !this._cjsProgram) {
			throw new Error('invalid state: CJS host/program not initialized');
		}
		const preEmitDiagnostics = ts.getPreEmitDiagnostics(this._cjsProgram, undefined, this._cancellationToken);
		handleDiagnostics(preEmitDiagnostics, this._cjsCompilerHost, 'Found syntax or type errors');
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
						after: [hoistExports()],
						afterDeclarations: []
					}
				: undefined
		);
		handleDiagnostics(cjsEmitResult.diagnostics, this._cjsCompilerHost, 'Error emitting CommonJS');
	}

	async cleanAndInitEsm(): Promise<void> {
		if (this._esmCompilerHost ?? this._esmProgram) {
			throw new Error('invalid state: ESM host/program already initialized');
		}

		if (this._config.shouldClean) {
			await this._cleanEsm();
		}

		const esmOptions = {
			...this._tsConfig.options,
			outDir: 'es',
			module: ts.ModuleKind.ESNext,
			// double declarations are not necessary
			declaration: false,
			// avoid type checks at all costs
			noResolve: true,
			noLib: true
		};
		this._esmCompilerHost = ts.createCompilerHost(esmOptions);
		this._esmCompilerHost.useSourceOfProjectReferenceRedirect = () => true;
		this._esmProgram = ts.createProgram({
			options: esmOptions,
			configFileParsingDiagnostics: this._tsConfig.errors,
			rootNames: this._tsConfig.fileNames,
			host: this._esmCompilerHost,
			projectReferences: this._tsConfig.projectReferences
		});
	}

	emitEsm(): void {
		if (!this._esmCompilerHost || !this._esmProgram) {
			throw new Error('invalid state: ESM host/program not initialized');
		}

		const esmEmitResult = this._esmProgram.emit(undefined, undefined, this._cancellationToken, undefined, {
			after: [resolveModulePaths()]
		});
		handleDiagnostics(esmEmitResult.diagnostics, this._esmCompilerHost, 'Error emitting ES modules');
	}

	async renameEsmOutputs(): Promise<void> {
		const configDir = path.dirname(this._tsConfigFilePath);
		await renameOutputFilesToMjs(path.join(configDir, 'es'));
	}

	private async _cleanCommonJs(): Promise<void> {
		const configDir = path.dirname(this._tsConfigFilePath);
		const { outDir } = this._tsConfig.options;
		if (outDir) {
			await fs.rm(path.resolve(configDir, outDir), { force: true, recursive: true });
		}
	}

	private async _cleanEsm(): Promise<void> {
		const configDir = path.dirname(this._tsConfigFilePath);
		await fs.rm(path.join(configDir, 'es'), { force: true, recursive: true });
	}
}
