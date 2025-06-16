import * as vscode from 'vscode';
import * as path from 'path';
import { DirectoryItem } from './types';

export class WorkspaceManager {
	static async addDirectoriesToWorkspace(directories: DirectoryItem[]): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const existingPaths = new Set(workspaceFolders.map(folder => folder.uri.fsPath.toLowerCase()));

		const newFolders: vscode.Uri[] = [];
		
		for (const dir of directories) {
			const normalizedPath = dir.fullPath.toLowerCase();
			if (!existingPaths.has(normalizedPath)) {
				newFolders.push(vscode.Uri.file(dir.fullPath));
			}
		}

		if (newFolders.length === 0) {
			vscode.window.showInformationMessage('All selected directories are already in the workspace.');
			return;
		}

		// Add folders to workspace
		const success = vscode.workspace.updateWorkspaceFolders(
			workspaceFolders.length, // Start index (append to end)
			0, // Delete count
			...newFolders.map(uri => ({ uri }))
		);

		if (success) {
			const folderNames = newFolders.map(uri => path.basename(uri.fsPath)).join(', ');
			vscode.window.showInformationMessage(`Added ${newFolders.length} folder(s) to workspace: ${folderNames}`);
		} else {
			vscode.window.showErrorMessage('Failed to add directories to workspace.');
		}
	}
}
