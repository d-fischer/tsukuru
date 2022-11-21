#!/usr/bin/env node
import { Command, Flags } from '@oclif/core';
import type { WrapperOptions } from './project/compile';
import { compile } from './project/compile';
import { exit, findConfigFile } from './util';

class Builder extends Command {
	/* eslint-disable @typescript-eslint/naming-convention */
	static flags = {
		version: Flags.version(),
		help: Flags.help(),
		'config-file': Flags.string({
			char: 'c',
			description: 'Path to a tsconfig.json file.'
		}),
		'no-cjs-root-export': Flags.boolean({
			char: 'R',
			description: "Disable require('pkg') as a shortcut to the package's defaultr export"
		}),
		clean: Flags.boolean({
			description: 'Remove the output files before building'
		})
	};
	/* eslint-enable @typescript-eslint/naming-convention */

	async run(): Promise<void> {
		const { flags: usedFlags } = await this.parse(Builder);
		const configFilePath = usedFlags['config-file'] ?? (await findConfigFile(process.cwd()));
		const options: WrapperOptions = {
			useCjsTransformers: !usedFlags['no-cjs-root-export'],
			shouldClean: usedFlags.clean
		};
		await compile(configFilePath, options);
		exit(0);
	}
}

// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
(Builder.run() as Promise<void>).catch(require('@oclif/errors/handle'));
