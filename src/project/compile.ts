import { promises as fs } from 'fs';
import * as ora from 'ora';
import * as path from 'path';
import * as ts from 'typescript';
import { withMjsExtensionHack } from '../mjsExtensionHack';
import { omit } from '../util';
import type { ProjectMode } from './modes/ProjectMode';
import { SimpleProjectMode } from './modes/SimpleProjectMode';
import { parseConfig } from './parseConfig';
import { hoistExports } from './transformers/hoistExports';
import { resolveModulePaths } from './transformers/resolveModulePaths';
import { splitEnumExports } from './transformers/splitEnumExports';

export interface WrapperOptions {
	useCjsTransformers?: boolean;
	shouldClean?: boolean;
}

interface OraHack {
	throbber?: ora.Ora;
	nextFrameTime: number;
}

interface RootTsConfigReference {
	path: string;
}

interface RootTsConfig {
	references: RootTsConfigReference[];
	include: string[];
}

function createStepFunctions(renderHackCancellationToken: ts.CancellationToken & OraHack) {
	function step(name: string, worker: () => void) {
		const throbber = ora({ text: `${name}... `, color: 'blue' });
		if (process.stderr.isTTY) {
			throbber.render();
		}
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

	return [step, stepAsync] as const;
}

async function execByInterface(
	project: ProjectMode,
	options: WrapperOptions,
	renderHackCancellationToken: ts.CancellationToken & OraHack
) {
	const [step, stepAsync] = createStepFunctions(renderHackCancellationToken);

	await project.init?.();
	await project.checkRequirements?.();

	await stepAsync(
		`${options.shouldClean ? 'Cleaning up and c' : 'C'}reating CommonJS compiler instance`,
		async () => {
			await project.cleanAndInitCommonJs();
		}
	);

	await project.checkRequirementsAfterInit?.();

	step('Checking for syntax and type errors', () => {
		project.checkTsErrors();
	});

	step('Emitting CommonJS modules', () => {
		project.emitCommonJs(options.useCjsTransformers ?? false);
	});

	await stepAsync(`${options.shouldClean ? 'Cleaning up and c' : 'C'}reating ESM compiler instance`, async () => {
		await project.cleanAndInitEsm();
	});

	step('Emitting ES Modules', () => {
		project.emitEsm();
	});
}

export async function compile(configFilePath: string, options: WrapperOptions): Promise<void> {
	const renderHackCancellationToken: ts.CancellationToken & OraHack = {
		throbber: undefined,
		nextFrameTime: Date.now(),
		isCancellationRequested() {
			if (this.throbber && process.stderr.isTTY) {
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

	const parsedConfig = parseConfig(configFilePath);

	function createProjectFromConfig(): ProjectMode | (() => Promise<void>) {
		if (!parsedConfig.projectReferences) {
			return new SimpleProjectMode(options, configFilePath, parsedConfig, renderHackCancellationToken);
		}

		return async () => {
			const [step, stepAsync] = createStepFunctions(renderHackCancellationToken);

			const cjsSolutionHost = ts.createSolutionBuilderHost();
			const cjsBuilder = ts.createSolutionBuilder(cjsSolutionHost, [configFilePath], {
				...omit(parsedConfig.options, ['tsConfigSourceFile']),
				force: false
			});

			if (options.shouldClean) {
				step('Cleaning CJS outputs', () => {
					cjsBuilder.clean();
				});
			}

			const pathToReferences = new Map<string, readonly ts.ProjectReference[] | undefined>();

			step('Checking & building changed projects for CJS', () => {
				while (true) {
					const proj = cjsBuilder.getNextInvalidatedProject();

					if (!proj) {
						break;
					}
					if (proj.kind === ts.InvalidatedProjectKind.Build) {
						const childConfigFilePath = proj.getCompilerOptions().configFilePath!;
						const program = proj.getProgram();
						if (program) {
							pathToReferences.set(childConfigFilePath, program.getProjectReferences());
						} else {
							console.log(`No program available for ${childConfigFilePath}`);
						}

						// linting goes here

						proj.emit(
							undefined,
							undefined,
							renderHackCancellationToken,
							undefined,
							options.useCjsTransformers
								? {
										before: [splitEnumExports()],
										after: [hoistExports()],
										afterDeclarations: []
								  }
								: undefined
						);
					}
					proj.done(renderHackCancellationToken);
				}

				cjsBuilder.close();
			});

			const esmBootstrapParentPath = path.join(process.cwd(), 'node_modules/.cache/tsukuru/esm-bootstrap');
			const esmParentTsConfigFileName = path.join(esmBootstrapParentPath, 'tsconfig.tsukuru-esm.json');

			await stepAsync('Bootstrapping ESM tsconfig files', async () => {
				let parentTsConfig: RootTsConfig = {
					references: [],
					include: []
				};

				if (options.shouldClean) {
					await fs.rm(esmBootstrapParentPath, { recursive: true });
				}
				await fs.mkdir(esmBootstrapParentPath, { recursive: true });

				try {
					const parentTsConfigContents = await fs.readFile(esmParentTsConfigFileName, 'utf-8');
					parentTsConfig = JSON.parse(parentTsConfigContents) as RootTsConfig;
				} catch (e) {
					// ignore
				}

				for (const [tsConfigPath, projectReferences] of pathToReferences) {
					const programBaseFolder = path.dirname(tsConfigPath);
					const programBaseFolderName = path.basename(programBaseFolder);
					const cacheFolder = path.join(esmBootstrapParentPath, programBaseFolderName);
					await fs.mkdir(cacheFolder, { recursive: true });
					const subConfigFileName = path.join(cacheFolder, 'tsconfig.json');
					if (!parentTsConfig.references.some(ref => ref.path === subConfigFileName)) {
						parentTsConfig.references.push({ path: subConfigFileName });
					}
					const esmTsConfigFd = await fs.open(subConfigFileName, 'w+');
					const esmTsConfig = {
						extends: tsConfigPath,
						compilerOptions: {
							module: 'esnext',
							outDir: path.join(programBaseFolder, 'es'),
							// avoid as many type checks as we can
							skipLibCheck: true
						},
						references: projectReferences?.map(ref => {
							const refName = path.basename(ref.path);

							return { path: path.join(esmBootstrapParentPath, refName) };
						}),
						include: [path.join(programBaseFolder, '**/*')]
					};
					const result = JSON.stringify(esmTsConfig);
					const fileContents = await esmTsConfigFd.readFile('utf-8');
					if (result !== fileContents) {
						await esmTsConfigFd.writeFile(result);
					}
					await esmTsConfigFd.close();
				}

				await fs.writeFile(esmParentTsConfigFileName, JSON.stringify(parentTsConfig), 'utf-8');
			});

			pathToReferences.clear();

			const esmSolutionHost = ts.createSolutionBuilderHost();
			const esmBuilder = ts.createSolutionBuilder(esmSolutionHost, [esmParentTsConfigFileName], {
				...omit(parsedConfig.options, ['tsConfigSourceFile']),
				force: false
			});

			if (options.shouldClean) {
				step('Cleaning ES module outputs', () => {
					esmBuilder.clean();
				});
			}

			step('Building ES modules', () => {
				const customTransformers: ts.CustomTransformers = {
					after: [resolveModulePaths()]
				};

				withMjsExtensionHack(() => {
					// TODO build each project separately and handle diagnostics
					esmBuilder.build(undefined, renderHackCancellationToken, undefined, () => customTransformers);
				});
				esmBuilder.close();
			});
		};
	}

	const project = createProjectFromConfig();

	if ('checkTsErrors' in project) {
		await execByInterface(project, options, renderHackCancellationToken);
	} else {
		await project();
	}
}
