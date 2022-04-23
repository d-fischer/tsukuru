#!/usr/bin/env node
import { Command, flags } from '@oclif/command';
import type { WrapperOptions } from './project/compile';
import { compile } from './project/compile';
import { exit, findConfigFile } from './util';

class Builder extends Command {
	/* eslint-disable @typescript-eslint/naming-convention */
	static flags = {
		version: flags.version(),
		help: flags.help(),
		'config-file': flags.string({
			char: 'c',
			description: 'Path to a tsconfig.json file.'
		}),
		'no-cjs-root-export': flags.boolean({
			char: 'R',
			description: "Disable require('pkg') as a shortcut to the package's defaultr export"
		}),
		clean: flags.boolean({
			description: 'Remove the output files before building'
		})
	};
	/* eslint-enable @typescript-eslint/naming-convention */

	async run(): Promise<void> {
		const { flags: usedFlags } = this.parse(Builder);
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
