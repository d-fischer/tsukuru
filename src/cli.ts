#!/usr/bin/env node
import { Command, flags } from '@oclif/command';
import { promises as fs } from 'fs';
import * as path from 'path';
import { compile, WrapperOptions } from './index';
import { exit } from './util';

// eslint-disable-next-line consistent-return
async function findConfigFile(): Promise<string> {
	let currentDir = process.cwd();
	while (currentDir) {
		const currentFileName = path.join(currentDir, 'tsconfig.json');
		try {
			await fs.access(currentFileName);
			return currentFileName;
		} catch (e) {
			// ignore
		}
		const newDir = path.dirname(currentDir);
		if (currentDir === newDir) {
			break;
		}
		currentDir = newDir;
	}
	console.error('A tsconfig file was not found.');
	exit(2);
}

class Builder extends Command {
	static flags = {
		version: flags.version(),
		help: flags.help(),
		'config-file': flags.string({
			char: 'c',
			description: 'Path to a tsconfig.json file.'
		}),
		'no-cjs-root-export': flags.boolean({
			char: 'R',
			description: "Disable require('pkg') as a shortcut to the package's root export"
		}),
		clean: flags.boolean({
			description: 'Remove the output files before building'
		})
	};

	async run(): Promise<void> {
		const { flags: usedFlags } = this.parse(Builder);
		const configFilePath = usedFlags['config-file'] ?? (await findConfigFile());
		const options: WrapperOptions = {
			useCjsTransformers: !usedFlags['no-cjs-root-export'],
			shouldClean: usedFlags.clean
		};
		exit(await compile(configFilePath, options));
	}
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
(Builder.run() as Promise<void>).catch(require('@oclif/errors/handle'));
