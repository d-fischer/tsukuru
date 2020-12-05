import * as chalk from 'chalk';

export function exit(exitCode: number): never {
	if (exitCode) {
		console.log(chalk.red(`Process exiting with error code '${exitCode}'.`));
	}
	process.exit(exitCode);
}
