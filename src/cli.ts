#!/usr/bin/env node
import { Command, flags } from '@oclif/command';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as _rimraf from 'rimraf';
import { promisify } from 'util';
import { compile, parseCmdLine } from './index';
import { exit } from './util';

const rimraf = promisify(_rimraf);

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
	exit(1);
}

class Builder extends Command {
	static flags = {
		version: flags.version(),
		help: flags.help(),
		configFile: flags.string({
			char: 'c',
			name: 'config-file',
			description: 'Path to a tsconfig.json file.'
		}),
		clean: flags.boolean({
			description: 'Remove the output files before building'
		})
	};

	async run(): Promise<void> {
		const { flags: usedFlags } = this.parse(Builder);
		const configFilePath = usedFlags.configFile ?? (await findConfigFile());
		const parsedCmd = parseCmdLine(configFilePath);
		if (usedFlags.clean) {
			console.log('Cleaning up...');
			const configDir = path.dirname(configFilePath);
			const { outDir } = parsedCmd.options;
			if (outDir) {
				await rimraf(path.resolve(configDir, outDir));
			}
			await rimraf(path.join(configDir, 'es'));
		}
		compile(parsedCmd);
	}
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
(Builder.run() as Promise<void>).catch(require('@oclif/errors/handle'));
