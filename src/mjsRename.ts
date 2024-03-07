import { promises as fs } from 'fs';
import * as path from 'path';

interface RenameTask {
	oldPath: string;
	newPath: string;
}

async function gatherFilesToRename(directory: string, result: RenameTask[] = []): Promise<RenameTask[]> {
	const files = await fs.readdir(directory, { withFileTypes: true });

	for (const file of files) {
		const oldPath = path.join(directory, file.name);
		if (file.isDirectory()) {
			result = await gatherFilesToRename(oldPath, result);
		} else if (file.name.endsWith('.js')) {
			const newName = `${file.name.slice(0, -3)}.mjs`;
			const newPath = path.join(directory, newName);

			result.push({ oldPath, newPath });
		}
	}

	return result;
}

export async function renameOutputFilesToMjs(directory: string): Promise<void> {
	await Promise.all(
		(await gatherFilesToRename(directory)).map(async ({ oldPath, newPath }) => {
			await fs.rename(oldPath, newPath);
		})
	);
}
