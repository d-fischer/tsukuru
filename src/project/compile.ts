import * as ora from 'ora';
import * as ts from 'typescript';
import { exit, formatDiagnostics, handleDiagnostics } from '../util';
// import { CompositeProjectMode } from './modes/CompositeProjectMode';
import type { ProjectMode } from './modes/ProjectMode';
import { SimpleProjectMode } from './modes/SimpleProjectMode';

export interface WrapperOptions {
	useCjsTransformers?: boolean;
	shouldClean?: boolean;
}

function handleConfigParsingErrors(parsedCommandLine: ts.ParsedCommandLine | undefined, host: ts.CompilerHost) {
	if (!parsedCommandLine) {
		process.stderr.write('\n\n');
		console.error('Unknown error parsing config.');
		exit(1);
	}
	if (parsedCommandLine.errors.length) {
		process.stderr.write('\n\n');
		console.error(formatDiagnostics(parsedCommandLine.errors, host));
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

export async function compile(
	configFilePath: string,
	{ useCjsTransformers, shouldClean }: WrapperOptions
): Promise<void> {
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

	const parsedConfig = parseConfig(configFilePath);

	// const project: ProjectMode = parsedConfig.projectReferences
	// 	? new CompositeProjectMode(configFilePath, parsedConfig, renderHackCancellationToken)
	// 	: new SimpleProjectMode(configFilePath, parsedConfig, renderHackCancellationToken);

	const project: ProjectMode = new SimpleProjectMode(configFilePath, parsedConfig, renderHackCancellationToken);

	await project.checkRequirements();

	step('Creating CommonJS compiler instance', () => {
		project.initCommonJs();
	});

	if (shouldClean) {
		await stepAsync('Cleaning up CommonJS emit results', async () => {
			await project.cleanCommonJs();
		});
	}

	step('Checking for syntax and type errors', () => {
		project.checkTsErrors();
	});

	step('Emitting CommonJS modules', () => {
		project.emitCommonJs(useCjsTransformers ?? false);
	});

	step('Creating ESM compiler instance', () => {
		project.initEsm();
	});

	if (shouldClean) {
		await stepAsync('Cleaning up ES Module emit results', async () => {
			await project.cleanEsm();
		});
	}

	step('Emitting ES Modules', () => {
		project.emitEsm();
	});
}
