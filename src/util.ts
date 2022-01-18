import * as chalk from 'chalk';
import * as ts from 'typescript';

export function exit(exitCode: number): never {
	if (exitCode) {
		console.log(chalk.red(`Process exiting with error code '${exitCode}'.`));
	}
	process.exit(exitCode);
}

export function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], host: ts.CompilerHost): string {
	const shouldBePretty = !!ts.sys.writeOutputIsTTY?.();
	const formatHost: ts.FormatDiagnosticsHost = {
		getCanonicalFileName(fileName: string) {
			return host.getCanonicalFileName(fileName);
		},
		getCurrentDirectory() {
			return host.getCurrentDirectory();
		},
		getNewLine() {
			return host.getNewLine();
		}
	};
	if (shouldBePretty) {
		return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
	}
	return ts.formatDiagnostics(diagnostics, formatHost);
}

export function handleDiagnostics(
	diagnostics: readonly ts.Diagnostic[],
	host: ts.CompilerHost,
	errorPrefix = 'Unknown error'
): void {
	if (diagnostics.length) {
		process.stderr.write('\n\n');
		console.error(formatDiagnostics(diagnostics, host));
		console.error(`${errorPrefix}. Exiting.`);
		exit(1);
	}
}
