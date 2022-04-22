import * as ora from 'ora';
import type * as ts from 'typescript';
import { CompositeProjectMode } from './modes/CompositeProjectMode';
import { MultiSimpleProjectMode } from './modes/MultiSimpleProjectMode';
import type { ProjectMode } from './modes/ProjectMode';
import { SimpleProjectMode } from './modes/SimpleProjectMode';
import { parseConfig } from './parseConfig';

export interface WrapperOptions {
	useCjsTransformers?: boolean;
	shouldClean?: boolean;
	experimentalCompositeProject?: boolean;
}

interface OraHack {
	throbber?: ora.Ora;
	nextFrameTime: number;
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

	function createProjectFromConfig(): ProjectMode {
		if (!parsedConfig.projectReferences) {
			return new SimpleProjectMode(options, configFilePath, parsedConfig, renderHackCancellationToken);
		}

		if (options.experimentalCompositeProject) {
			return new CompositeProjectMode(options, configFilePath, parsedConfig, renderHackCancellationToken);
		}

		return new MultiSimpleProjectMode(options, parsedConfig, renderHackCancellationToken);
	}

	const project = createProjectFromConfig();

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
