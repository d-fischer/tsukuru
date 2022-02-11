import * as path from 'path';
import * as ts from 'typescript';
import { UpToDateStatusType } from 'typescript';
import { exit, handleDiagnostics, omit } from '../../util';
import type { WrapperOptions } from '../compile';
import { parseConfig } from '../parseConfig';
import { hoistExports } from '../transformers/hoistExports';
import { resolveModulePaths } from '../transformers/resolveModulePaths';
import { splitEnumExports } from '../transformers/splitEnumExports';
import type { ProjectMode } from './ProjectMode';
import { inspect } from 'util';

inspect.defaultOptions.depth = null;

type BuildType = 'cjs' | 'esm';

interface InternalProjectState {
	tsCompilerHost?: ts.CompilerHost;
	tsProgram?: ts.Program;
}

interface ProjectInfo {
	tsConfig: ts.ParsedCommandLine;
	upToDateStatus: ts.UpToDateStatus;
	internalState: InternalProjectState;
}

export class CompositeProjectMode implements ProjectMode {
	private _cjsSolutionHost?: ts.SolutionBuilderHost<ts.EmitAndSemanticDiagnosticsBuilderProgram>;
	private _esmSolutionHost?: ts.SolutionBuilderHost<ts.EmitAndSemanticDiagnosticsBuilderProgram>;

	private _cjsProjects?: Map<string, ProjectInfo>;
	private _esmProjects?: Map<string, ProjectInfo>;

	constructor(
		private readonly _config: WrapperOptions,
		private readonly _tsConfigFilePath: string,
		private readonly _tsConfig: ts.ParsedCommandLine,
		private readonly _cancellationToken: ts.CancellationToken
	) {}

	cleanAndInitCommonJs(): void {
		if (this._cjsSolutionHost) {
			throw new Error('invalid state: CJS host already initialized');
		}
		this._cjsSolutionHost = ts.createSolutionBuilderHost();
		const builder = ts.createSolutionBuilder(this._cjsSolutionHost, [this._tsConfigFilePath], {
			...omit(this._tsConfig.options, ['tsConfigSourceFile']),
			force: true
		});
		const tsBuildOrder = builder.getBuildOrder();
		if ('buildOrder' in tsBuildOrder) {
			throw new Error('Circular build order currently not supported');
		}
		const buildOrder = tsBuildOrder as readonly string[];
		const configs = builder.getAllParsedConfigs();
		if (this._config.shouldClean) {
			builder.clean();
		}
		this._cjsProjects = new Map<string, ProjectInfo>(
			configs
				.filter(conf => conf.fileNames.length)
				.sort(
					(a, b) =>
						buildOrder.indexOf(a.options.configFilePath!) - buildOrder.indexOf(b.options.configFilePath!)
				)
				.map(tsConfig => [
					tsConfig.options.configFilePath!,
					{
						tsConfig,
						upToDateStatus: builder.getUpToDateStatusOfProject(tsConfig.options.configFilePath!),
						internalState: {}
					}
				])
		);
	}

	checkRequirementsAfterInit(): void {
		if (!this._cjsSolutionHost || !this._cjsProjects) {
			throw new Error('invalid state: CJS host not initialized');
		}

		for (const [configPath, proj] of this._cjsProjects.entries()) {
			if (!proj.tsConfig.options.isolatedModules) {
				console.error(
					`This tool depends on the isolatedModules option. Please enable it in your ${path.basename(
						configPath
					)} file in your project named ${this._getProjectName(proj)}.`
				);
				exit(1);
			}
		}
	}

	checkTsErrors(): void {
		if (!this._cjsSolutionHost || !this._cjsProjects) {
			throw new Error('invalid state: CJS host not initialized');
		}
		for (const proj of this._cjsProjects.values()) {
			if (proj.upToDateStatus.type === ts.UpToDateStatusType.UpToDate && !this._config.shouldClean) {
				continue;
			}
			const program = this._ensureProgram(proj, 'cjs');
			const preEmitDiagnostics = ts.getPreEmitDiagnostics(program, undefined, this._cancellationToken);
			handleDiagnostics(
				preEmitDiagnostics,
				undefined,
				`Found syntax or type errors in the project ${this._getProjectName(proj)}`
			);
		}
	}

	emitCommonJs(useTransformers: boolean): void {
		if (!this._cjsSolutionHost || !this._cjsProjects) {
			throw new Error('invalid state: CJS host not initialized');
		}
		for (const proj of this._cjsProjects.values()) {
			if (proj.upToDateStatus.type === UpToDateStatusType.UpToDate && !this._config.shouldClean) {
				continue;
			}
			const host = this._ensureCompilerHost(proj, 'cjs');
			const program = this._ensureProgram(proj, 'cjs');
			const cjsEmitResult = program.emit(
				undefined,
				undefined,
				this._cancellationToken,
				undefined,
				useTransformers
					? {
							before: [splitEnumExports()],
							after: [hoistExports(program)],
							afterDeclarations: []
					  }
					: undefined
			);
			handleDiagnostics(cjsEmitResult.diagnostics, host, 'Error emitting CommonJS');
		}
	}

	cleanAndInitEsm(): void {
		if (this._esmSolutionHost) {
			throw new Error('invalid state: ESM host/program already initialized');
		}

		this._esmSolutionHost = ts.createSolutionBuilderHost();
		this._esmSolutionHost.getParsedCommandLine = fileName => {
			const containingFolder = path.dirname(fileName);
			return fileName === this._tsConfigFilePath
				? parseConfig(fileName)
				: parseConfig(fileName, {
						outDir: path.join(containingFolder, 'es'),
						tsBuildInfoFile: path.join(
							containingFolder,
							`${path.basename(fileName, '.json')}.tsukuru-esm.tsbuildinfo`
						)
				  });
		};
		const builder = ts.createSolutionBuilder(this._esmSolutionHost, [this._tsConfigFilePath], {
			...omit(this._tsConfig.options, ['tsConfigSourceFile']),
			force: true
		});

		const tsBuildOrder = builder.getBuildOrder();
		if ('buildOrder' in tsBuildOrder) {
			throw new Error('Circular build order currently not supported');
		}
		const buildOrder = tsBuildOrder as readonly string[];
		const configs = builder.getAllParsedConfigs();

		if (this._config.shouldClean) {
			builder.clean();
		}
		this._esmProjects = new Map<string, ProjectInfo>(
			configs
				.filter(conf => conf.fileNames.length)
				.sort(
					(a, b) =>
						buildOrder.indexOf(a.options.configFilePath!) - buildOrder.indexOf(b.options.configFilePath!)
				)
				.map(tsConfig => [
					tsConfig.options.configFilePath!,
					{
						tsConfig,
						upToDateStatus: builder.getUpToDateStatusOfProject(tsConfig.options.configFilePath!),
						internalState: {}
					}
				])
		);
	}

	emitEsm(): void {
		if (!this._esmSolutionHost || !this._esmProjects) {
			throw new Error('invalid state: ESM host not initialized');
		}

		// HACK: there's no API for this so we have to monkey patch a private TS  aPI
		/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
		const origOutputPath: (fileName: string, host: unknown, extension: string) => string =
			ts.getOwnEmitOutputFilePath;
		(ts as any).getOwnEmitOutputFilePath = function getOwnEmitOutputFilePath(
			fileName: string,
			host: unknown,
			extension: string
		) {
			const newExtension = extension === '.js' ? '.mjs' : extension;
			return origOutputPath(fileName, host, newExtension);
		};
		for (const proj of this._esmProjects.values()) {
			if (proj.upToDateStatus.type === UpToDateStatusType.UpToDate && !this._config.shouldClean) {
				continue;
			}
			const host = this._ensureCompilerHost(proj, 'esm');
			const program = this._ensureProgram(proj, 'esm');
			const esmEmitResult = program.emit(undefined, undefined, this._cancellationToken, undefined, {
				after: [resolveModulePaths()]
			});
			handleDiagnostics(esmEmitResult.diagnostics, host, 'Error emitting ES modules');
		}

		(ts as any).getOwnEmitOutputFilePath = origOutputPath;
	}

	private _getCompilerOptions(proj: ProjectInfo, buildType: BuildType): ts.CompilerOptions {
		return buildType === 'esm'
			? {
					...proj.tsConfig.options,
					outDir: 'es',
					module: ts.ModuleKind.ESNext,
					// double declarations are not necessary
					declaration: false,
					// avoid type checks at all costs
					noResolve: true,
					noLib: true
			  }
			: proj.tsConfig.options;
	}

	private _ensureCompilerHost(proj: ProjectInfo, buildType: BuildType) {
		if (proj.internalState.tsCompilerHost) {
			return proj.internalState.tsCompilerHost;
		}
		const host = ts.createCompilerHost(this._getCompilerOptions(proj, buildType));
		host.useSourceOfProjectReferenceRedirect = () => true;
		return (proj.internalState.tsCompilerHost = host);
	}

	private _ensureProgram(proj: ProjectInfo, buildType: BuildType) {
		if (proj.internalState.tsProgram) {
			return proj.internalState.tsProgram;
		}

		const host = this._ensureCompilerHost(proj, buildType);

		const options: ts.CompilerOptions =
			buildType === 'esm'
				? {
						...proj.tsConfig.options,
						outDir: path.join(path.dirname(proj.tsConfig.options.outDir!), 'es'),
						module: ts.ModuleKind.ESNext,
						// double declarations are not necessary
						declaration: false,
						// avoid type checks at all costs
						noResolve: true,
						noLib: true,
						composite: false
				  }
				: proj.tsConfig.options;

		return (proj.internalState.tsProgram = ts.createProgram({
			options,
			configFileParsingDiagnostics: proj.tsConfig.errors,
			rootNames: proj.tsConfig.fileNames,
			host,
			projectReferences: proj.tsConfig.projectReferences
		}));
	}

	private _getProjectName(info: ProjectInfo) {
		return path.basename(path.dirname(info.tsConfig.options.configFilePath!));
	}
}
