import * as vscode from 'vscode';
import * as path from 'path';
import { DirectoryItem, DirectoryAction } from './types';
import { ConfigurationManager } from './configuration';

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
			vscode.window.showInformationMessage(`Added ${newFolders.length} folder(s) to workspace: ${folderNames}`);		} else {
			vscode.window.showErrorMessage('Failed to add directories to workspace.');
		}
	}

	static async openDirectoriesInWindow(directories: DirectoryItem[]): Promise<void> {
		const openInNewWindow = ConfigurationManager.shouldOpenInNewWindow();

		if (directories.length === 1) {
			// Single directory - open it directly
			const directory = directories[0];
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(directory.fullPath), openInNewWindow);
			
			const action = openInNewWindow ? 'new window' : 'current window';
			vscode.window.showInformationMessage(`Opened ${path.basename(directory.fullPath)} in ${action}`);
		} else {
			// Multiple directories - create a workspace file or ask user what to do
			await this.handleMultipleDirectories(directories, openInNewWindow);
		}
	}

	private static async handleMultipleDirectories(directories: DirectoryItem[], openInNewWindow: boolean): Promise<void> {
		const options = [
			'Open each in separate window',
			'Create workspace with all folders'
		];

		const choice = await vscode.window.showQuickPick(options, {
			placeHolder: `How would you like to open ${directories.length} directories?`
		});

		if (!choice) {
			return;
		}

		if (choice === 'Open each in separate window') {
			// Open each directory in its own window
			for (const directory of directories) {
				await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(directory.fullPath), true);
			}
			vscode.window.showInformationMessage(`Opened ${directories.length} directories in separate windows`);
		} else {
			// Create a new workspace with all folders
			const folders = directories.map(dir => ({ uri: vscode.Uri.file(dir.fullPath) }));
			await vscode.workspace.updateWorkspaceFolders(0, 0, ...folders);
			
			if (openInNewWindow) {
				// Save current workspace and open in new window
				await vscode.commands.executeCommand('workbench.action.files.saveWorkspaceAs');
			}
			
			const folderNames = directories.map(dir => path.basename(dir.fullPath)).join(', ');
			const action = openInNewWindow ? 'new window' : 'current window';
			vscode.window.showInformationMessage(`Created workspace with ${directories.length} folders in ${action}: ${folderNames}`);
		}
	}
}
