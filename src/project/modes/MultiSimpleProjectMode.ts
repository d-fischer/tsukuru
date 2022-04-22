import * as toposort from 'toposort';
import type * as ts from 'typescript';
import type { WrapperOptions } from '../compile';
import { parseConfig } from '../parseConfig';
import type { ProjectMode } from './ProjectMode';
import { SimpleProjectMode } from './SimpleProjectMode';

export class MultiSimpleProjectMode implements ProjectMode {
	private _projects = new Map<string, SimpleProjectMode>();
	private _projectOrder: string[] = [];

	constructor(
		private readonly _config: WrapperOptions,
		private readonly _baseTsConfig: ts.ParsedCommandLine,
		private readonly _cancellationToken: ts.CancellationToken
	) {}

	async init(): Promise<void> {
		const refs = this._baseTsConfig.projectReferences!;
		const projects = new Map(refs.map(ref => [ref.path, parseConfig(ref.path)]));
		this._projects = new Map(
			[...projects].map(([tsConfigPath, tsConfig]) => [
				tsConfigPath,
				new SimpleProjectMode(this._config, tsConfigPath, tsConfig, this._cancellationToken)
			])
		);
		const dependencies = [...projects].flatMap(
			([tsConfigPath, tsConfig]) =>
				tsConfig.projectReferences?.map((ref): [string, string] => [tsConfigPath, ref.path]) ?? []
		);

		this._projectOrder = toposort(dependencies).reverse();
	}

	checkRequirements(): void {
		for (const proj of this._getProjectsInOrder()) {
			proj.checkRequirements();
		}
	}

	async cleanAndInitCommonJs(): Promise<void> {
		for (const proj of this._getProjectsInOrder()) {
			await proj.cleanAndInitCommonJs();
		}
	}

	checkTsErrors(): void {
		for (const proj of this._getProjectsInOrder()) {
			proj.checkTsErrors();
		}
	}

	emitCommonJs(useTransformers: boolean): void {
		for (const proj of this._getProjectsInOrder()) {
			proj.emitCommonJs(useTransformers);
		}
	}

	async cleanAndInitEsm(): Promise<void> {
		for (const proj of this._getProjectsInOrder()) {
			await proj.cleanAndInitEsm();
		}
	}

	emitEsm(): void {
		for (const proj of this._getProjectsInOrder()) {
			proj.emitEsm();
		}
	}

	private _getProjectsInOrder() {
		if (!this._projectOrder.length) {
			throw new Error('Project order empty, please make sure your project references are set up properly');
		}

		return this._projectOrder.map(path => this._projects.get(path)!);
	}
}
