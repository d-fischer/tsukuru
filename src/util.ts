import * as chalk from 'chalk';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createGetCanonicalFileName } from 'typescript';
import * as ts from 'typescript';

export function exit(exitCode: number): never {
	if (exitCode) {
		console.log(chalk.red(`Process exiting with error code '${exitCode}'.`));
	}
	process.exit(exitCode);
}

// eslint-disable-next-line consistent-return
export async function findConfigFile(initialDir: string): Promise<string> {
	let currentDir = initialDir;
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

export function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], host?: ts.CompilerHost): string {
	const shouldBePretty = !!ts.sys.writeOutputIsTTY?.();
	const formatHost: ts.FormatDiagnosticsHost = host ?? {
		getCanonicalFileName: createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames),
		getCurrentDirectory() {
			return ts.sys.getCurrentDirectory();
		},
		getNewLine() {
			return '\n';
		}
	};
	if (shouldBePretty) {
		return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
	}
	return ts.formatDiagnostics(diagnostics, formatHost);
}

export function handleDiagnostics(
	diagnostics: readonly ts.Diagnostic[],
	host: ts.CompilerHost | undefined,
	errorPrefix = 'Unknown error'
): void {
	if (diagnostics.length) {
		process.stderr.write('\n\n');
		console.error(formatDiagnostics(diagnostics, host));
		console.error(`${errorPrefix}. Exiting.`);
		exit(1);
	}
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
	return Object.assign(
		{},
		...Object.entries(obj)
			.filter(([key]) => keys.includes(key as K))
			.map(([key, value]) => ({ [key]: value as T[K] }))
	) as Pick<T, K>;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
	return pick(obj, Object.keys(obj).filter(key => !keys.includes(key as K)) as Array<keyof T>);
}
