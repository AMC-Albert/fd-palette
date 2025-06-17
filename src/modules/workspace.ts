import * as vscode from "vscode";
import * as path from "path";
import { DirectoryItem, DirectoryAction } from "./types";
import { ConfigurationManager } from "./configuration";

export class WorkspaceManager {
	/**
	 * Show an information message with a visual countdown progress bar
	 */
	private static async showTimedInfoMessage(
		message: string,
		durationMs: number = 3000
	): Promise<void> {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: message,
				cancellable: false,
			},
			async (progress) => {
				const steps = 100;
				const stepDuration = durationMs / steps;

				for (let i = 0; i <= steps; i++) {
					progress.report({ increment: 1 });
					await new Promise((resolve) => setTimeout(resolve, stepDuration));
				}
			}
		);
	}

	static async addDirectoriesToWorkspace(
		directories: DirectoryItem[]
	): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const existingPaths = new Set(
			workspaceFolders.map((folder) => folder.uri.fsPath.toLowerCase())
		);

		const newFolders: vscode.Uri[] = [];

		for (const dir of directories) {
			const normalizedPath = dir.fullPath.toLowerCase();
			if (!existingPaths.has(normalizedPath)) {
				newFolders.push(vscode.Uri.file(dir.fullPath));
			}
		}
		if (newFolders.length === 0) {
			await this.showTimedInfoMessage(
				"All selected directories are already in the workspace."
			);
			return;
		}

		// Add folders to workspace
		const success = vscode.workspace.updateWorkspaceFolders(
			workspaceFolders.length, // Start index (append to end)
			0, // Delete count
			...newFolders.map((uri) => ({ uri }))
		);
		if (success) {
			const folderNames = newFolders
				.map((uri) => path.basename(uri.fsPath))
				.join(", ");
			await this.showTimedInfoMessage(
				`Added ${newFolders.length} folder(s) to workspace: ${folderNames}`
			);
		} else {
			vscode.window.showErrorMessage("Failed to add directories to workspace.");
		}
	}
	static async openDirectoriesInNewWindow(
		directories: DirectoryItem[],
		forceNewWindow: boolean = false
	): Promise<void> {
		// Use the forceNewWindow parameter directly instead of config
		const openInWindow = forceNewWindow;

		if (directories.length === 1) {
			// Single directory - open it directly
			const directory = directories[0];
			await vscode.commands.executeCommand(
				"vscode.openFolder",
				vscode.Uri.file(directory.fullPath),
				openInWindow
			);
			const action = openInWindow ? "new window" : "current window";
			await this.showTimedInfoMessage(
				`Opened ${path.basename(directory.fullPath)} in ${action}`
			);
		} else {
			// Multiple directories - create a workspace file or ask user what to do
			await this.handleMultipleDirectories(directories, openInWindow);
		}
	}

	private static async handleMultipleDirectories(
		directories: DirectoryItem[],
		openInWindow: boolean
	): Promise<void> {
		const options = [
			"Open each in separate window",
			"Create workspace with all folders",
		];

		const choice = await vscode.window.showQuickPick(options, {
			placeHolder: `How would you like to open ${directories.length} directories?`,
		});

		if (!choice) {
			return;
		}

		if (choice === "Open each in separate window") {
			// Open each directory in its own window
			for (const directory of directories) {
				await vscode.commands.executeCommand(
					"vscode.openFolder",
					vscode.Uri.file(directory.fullPath),
					true
				);
			}
			await this.showTimedInfoMessage(
				`Opened ${directories.length} directories in separate windows`
			);
		} else {
			// Create a new workspace with all folders
			const folders = directories.map((dir) => ({
				uri: vscode.Uri.file(dir.fullPath),
			}));
			await vscode.workspace.updateWorkspaceFolders(0, 0, ...folders);

			if (openInWindow) {
				// Save current workspace and open in window
				await vscode.commands.executeCommand(
					"workbench.action.files.saveWorkspaceAs"
				);
			}
			const folderNames = directories
				.map((dir) => path.basename(dir.fullPath))
				.join(", ");
			const action = openInWindow ? "new window" : "current window";
			await this.showTimedInfoMessage(
				`Created workspace with ${directories.length} folders in ${action}: ${folderNames}`
			);
		}
	}

	/**
	 * Remove the selected folder from the workspace
	 */
	static async removeSelectedFolder(): Promise<void> {
		// Get current workspace folders
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage("No workspace folders are open");
			return;
		}

		// Safety check: only proceed if there are multiple workspace folders
		if (workspaceFolders.length <= 1) {
			await this.showTimedInfoMessage(
				"Cannot remove the only workspace folder"
			);
			return;
		}

		// Get the selected folder from explorer
		const selectedUri = await this.getSelectedFolderFromExplorer();
		if (!selectedUri) {
			vscode.window.showErrorMessage("No folder selected in explorer");
			return;
		}

		// Find the workspace folder that exactly matches the selected resource
		const folderToRemove = workspaceFolders.find(
			(folder) => folder.uri.fsPath === selectedUri.fsPath
		);

		if (!folderToRemove) {
			// Selected item is not a root workspace folder
			return;
		}

		// Get the index of the folder to remove
		const folderIndex = workspaceFolders.indexOf(folderToRemove);

		// Remove the folder from workspace
		const success = vscode.workspace.updateWorkspaceFolders(
			folderIndex, // start index
			1 // delete count
			// no folders to add
		);
		if (!success) {
			vscode.window.showErrorMessage("Failed to remove folder from workspace");
		} else {
			console.log(
				`rip-open: Removed folder from workspace: ${folderToRemove.uri.fsPath}`
			);
			await this.showTimedInfoMessage(
				`Removed ${path.basename(folderToRemove.uri.fsPath)} from workspace`
			);
		}
	}

	/**
	 * Get the currently selected folder from the explorer using clipboard method
	 */
	private static async getSelectedFolderFromExplorer(): Promise<
		vscode.Uri | undefined
	> {
		try {
			// Store current clipboard content to restore later
			const originalClipboard = await vscode.env.clipboard.readText();

			// Execute copy file path command (this will copy the selected explorer item)
			await vscode.commands.executeCommand("copyFilePath");

			// Get the copied path
			const clipboardContent = await vscode.env.clipboard.readText();

			// Restore original clipboard content
			await vscode.env.clipboard.writeText(originalClipboard);

			if (clipboardContent && clipboardContent !== originalClipboard) {
				return vscode.Uri.file(clipboardContent);
			}
		} catch (error) {
			console.error("rip-open: Could not determine selected folder:", error);
			vscode.window.showErrorMessage("Could not determine selected folder");
		}

		return undefined;
	}
}
