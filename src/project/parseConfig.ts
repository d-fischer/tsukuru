import * as ts from 'typescript';
import { exit, formatDiagnostics, handleDiagnostics } from '../util';

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

export function parseConfig(configFilePath: string, baseOptions: ts.CompilerOptions = {}): ts.ParsedCommandLine {
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
	const parsedConfig = ts.getParsedCommandLineOfConfigFile(configFilePath, baseOptions, {
		...configParsingHost,
		onUnRecoverableConfigFileDiagnostic(d) {
			handleDiagnostics([d], tempCompilerHost);
		}
	})!;

	handleConfigParsingErrors(parsedConfig, tempCompilerHost);

	return parsedConfig;
}
