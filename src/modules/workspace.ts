import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DirectoryItem, DirectoryAction, ItemType } from "./types";
import { ConfigurationManager } from "./configuration";
import { FileUtils, MessageUtils } from "./utils";

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
		items: DirectoryItem[]
	): Promise<void> {
		const {
			allDirectories,
			extractedPaths,
			allInvalidPaths,
			workspaceFiles,
			totalWorkspacePaths,
		} = await this.processDirectoryItems(items);

		if (allDirectories.length === 0) {
			if (workspaceFiles.length > 0 && allInvalidPaths.length > 0) {
				// Specific error for workspace files with invalid paths
				const invalidPathsList = allInvalidPaths.slice(0, 3).join(", ");
				const moreText =
					allInvalidPaths.length > 3
						? ` and ${allInvalidPaths.length - 3} more`
						: "";
				vscode.window.showWarningMessage(
					`No valid directories found in workspace file(s). Invalid paths: ${invalidPathsList}${moreText}`
				);
			} else {
				await MessageUtils.showInfo(
					"No valid directories found to add to workspace."
				);
			}
			return;
		} // Handle directories normally
		const workspaceFolders = vscode.workspace.workspaceFolders || [];

		const existingPaths = new Set(
			workspaceFolders.map((folder) => folder.uri.fsPath.toLowerCase())
		);

		const newFolders: vscode.Uri[] = [];

		for (const dir of allDirectories) {
			const normalizedPath = dir.fullPath.toLowerCase();
			if (!existingPaths.has(normalizedPath)) {
				newFolders.push(vscode.Uri.file(dir.fullPath));
			}
		}
		if (newFolders.length === 0) {
			let message = "All selected directories are already in the workspace.";

			// If there were workspace files with invalid paths, mention them
			if (workspaceFiles.length > 0 && allInvalidPaths.length > 0) {
				const invalidPathsList = allInvalidPaths.slice(0, 2).join(", ");
				const moreText =
					allInvalidPaths.length > 2
						? ` and ${allInvalidPaths.length - 2} more`
						: "";
				await MessageUtils.showInfo(message);
				await MessageUtils.showWarning(
					`${allInvalidPaths.length} path(s) from workspace file(s) were invalid: ${invalidPathsList}${moreText}`
				);
			} else {
				await MessageUtils.showInfo(message);
			}
			return;
		} // Add folders to workspace
		const success = vscode.workspace.updateWorkspaceFolders(
			workspaceFolders.length, // Start index (append to end)
			0, // Delete count
			...newFolders.map((uri) => ({ uri }))
		);

		if (success) {
			const folderNames = newFolders
				.map((uri) => path.basename(uri.fsPath))
				.join(", ");

			let message = `Added ${newFolders.length} folder(s) to workspace: ${folderNames}`;
			if (workspaceFiles.length > 0) {
				message += ` (${extractedPaths.length} extracted from ${workspaceFiles.length} workspace file(s))`;
			}

			vscode.window.showInformationMessage(message);
			console.log(`rip-open: ${message}`);

			// Show warning about invalid paths if any were found
			if (allInvalidPaths.length > 0) {
				const invalidPathsList = allInvalidPaths.slice(0, 2).join(", ");
				const moreText =
					allInvalidPaths.length > 2
						? ` and ${allInvalidPaths.length - 2} more`
						: "";
				vscode.window.showWarningMessage(
					`Note: ${allInvalidPaths.length} path(s) from workspace file(s) were invalid: ${invalidPathsList}${moreText}`
				);
			}
		} else {
			console.error(`rip-open: Failed to add directories to workspace`);
			await MessageUtils.showError("Failed to add directories to workspace.");
		}
	}
	static async openDirectoriesInNewWindow(
		items: DirectoryItem[],
		forceNewWindow: boolean = false
	): Promise<void> {
		// Separate workspace files from directories
		const workspaceFiles = items.filter(
			(item) => item.itemType === ItemType.WorkspaceFile
		);
		const directories = items.filter(
			(item) => item.itemType !== ItemType.WorkspaceFile
		);

		// Handle workspace files - open them directly
		for (const workspaceFile of workspaceFiles) {
			await vscode.commands.executeCommand(
				"vscode.openFolder",
				vscode.Uri.file(workspaceFile.fullPath),
				forceNewWindow
			);
		}

		// If we only had workspace files, return early
		if (directories.length === 0) {
			return;
		}

		// Use the forceNewWindow parameter directly instead of config
		const openInWindow = forceNewWindow;
		if (directories.length === 1) {
			// Single directory - open it directly
			const directory = directories[0];
			await this.openSingleDirectory(directory.fullPath, openInWindow);
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
				`Opened ${directories.length} directories in separate windows`			);		} else {
			// Create a workspace with all folders - prompt user to save it
			try {
				// Create workspace content with all selected directories
				const workspaceContent = {
					folders: directories.map((dir) => ({ path: dir.fullPath })),
				};

				// Prompt user to save the workspace file
				const saveUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(`workspace-${Date.now()}.code-workspace`),
					filters: {
						'VS Code Workspace': ['code-workspace']
					},
					saveLabel: 'Save Workspace'
				});

				if (!saveUri) {
					// User cancelled
					return;
				}

				// Write the workspace file
				const fs = await import("fs/promises");
				await fs.writeFile(
					saveUri.fsPath,
					JSON.stringify(workspaceContent, null, 2)
				);

				// Open the workspace file
				await vscode.commands.executeCommand("vscode.openFolder", saveUri, {
					forceNewWindow: openInWindow,
				});

				const folderNames = directories
					.map((dir) => path.basename(dir.fullPath))
					.join(", ");
				await this.showTimedInfoMessage(
					`Created and opened workspace with ${directories.length} folders: ${folderNames}`
				);
			} catch (error) {
				await MessageUtils.showError(
					`Failed to create workspace file: ${error}`
				);
			}
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
	 * Remove all existing workspace folders
	 */
	static async removeAllWorkspaceFolders(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return; // No folders to remove
		}

		// Remove all existing folders
		const success = vscode.workspace.updateWorkspaceFolders(
			0, // Start index (from beginning)
			workspaceFolders.length // Delete count (remove all)
		);

		if (success) {
			console.log(
				`rip-open: Removed ${workspaceFolders.length} existing workspace folders`
			);
		} else {
			throw new Error("Failed to remove existing workspace folders");
		}
	}

	/**
	 * Replace all workspace folders with new ones (remove existing + add new)
	 */
	static async replaceWorkspaceFolders(items: DirectoryItem[]): Promise<void> {
		try {
			console.log(
				`rip-open: Starting replaceWorkspaceFolders with ${items.length} items`
			);

			const {
				allDirectories,
				extractedPaths,
				allInvalidPaths,
				workspaceFiles,
				totalWorkspacePaths,
			} = await this.processDirectoryItems(items);

			if (allDirectories.length === 0) {
				if (workspaceFiles.length > 0 && allInvalidPaths.length > 0) {
					// Specific error for workspace files with invalid paths
					const invalidPathsList = allInvalidPaths.slice(0, 3).join(", ");
					const moreText =
						allInvalidPaths.length > 3
							? ` and ${allInvalidPaths.length - 3} more`
							: "";
					vscode.window.showWarningMessage(
						`No valid directories found in workspace file(s). Invalid paths: ${invalidPathsList}${moreText}`
					);
				} else {
					await MessageUtils.showInfo(
						"No valid directories found to replace workspace with."
					);
				}
				return;
			}
			const workspaceFolders = vscode.workspace.workspaceFolders || [];
			const currentFolderCount = workspaceFolders.length;

			console.log(
				`rip-open: Current workspace has ${currentFolderCount} folders`
			);

			// Check if we're trying to replace with the exact same folders
			const currentPaths = new Set(
				workspaceFolders.map((folder) => folder.uri.fsPath.toLowerCase())
			);
			const newPaths = new Set(
				allDirectories.map((item) => item.fullPath.toLowerCase())
			);

			// Compare sets to see if they're identical
			const sameSize = currentPaths.size === newPaths.size;
			const sameContent =
				sameSize &&
				Array.from(currentPaths).every((path) => newPaths.has(path));

			if (sameContent) {
				let message = `Workspace already contains these ${allDirectories.length} folder(s)`;
				if (workspaceFiles.length > 0) {
					message += ` (${extractedPaths.length} extracted from ${workspaceFiles.length} workspace file(s))`;
				}
				vscode.window.showInformationMessage(message);
				console.log(`rip-open: ${message} - no changes needed`);
				return;
			}

			// Create workspace folder objects for the directories (both regular and extracted)
			const newWorkspaceFolders = allDirectories.map((item) => ({
				uri: vscode.Uri.file(item.fullPath),
			}));

			console.log(
				`rip-open: Will replace with ${
					allDirectories.length
				} folders: ${allDirectories.map((item) => item.fullPath).join(", ")}`
			);

			// Replace all existing folders with new ones in a single operation
			const success = vscode.workspace.updateWorkspaceFolders(
				0, // start index (remove from beginning)
				currentFolderCount, // delete count (remove all existing)
				...newWorkspaceFolders // add new folders
			);

			console.log(`rip-open: updateWorkspaceFolders result: ${success}`);

			if (success) {
				let message = `Replaced workspace with ${allDirectories.length} folder(s)`;
				if (workspaceFiles.length > 0) {
					message += ` (${extractedPaths.length} extracted from ${workspaceFiles.length} workspace file(s))`;
				}

				vscode.window.showInformationMessage(message);
				console.log(`rip-open: Completed replaceWorkspaceFolders - ${message}`);

				// Show warning about invalid paths if any were found
				if (allInvalidPaths.length > 0) {
					const invalidPathsList = allInvalidPaths.slice(0, 2).join(", ");
					const moreText =
						allInvalidPaths.length > 2
							? ` and ${allInvalidPaths.length - 2} more`
							: "";
					vscode.window.showWarningMessage(
						`Note: ${allInvalidPaths.length} path(s) from workspace file(s) were invalid: ${invalidPathsList}${moreText}`
					);
				}
			} else {
				const errorMsg = "Failed to replace workspace folders";
				console.error(`rip-open: ${errorMsg}`);
				await MessageUtils.showError(errorMsg);
			}
		} catch (error) {
			console.error(`rip-open: Error in replaceWorkspaceFolders:`, error);
			await MessageUtils.showError(
				`Failed to replace workspace folders: ${error}`
			);
			throw error;
		}
	}

	/**
	 * Replace workspace with parent folder of current workspace folder
	 */
	static async replaceWorkspaceWithParentFolder(): Promise<void> {
		try {
			const result = await this.getParentDirectoryFromWorkspace();
			if (!result) {
				return; // Error already shown or user cancelled
			}

			const { parentPath } = result;

			// Create DirectoryItem for the parent folder
			const parentDirectoryItem: DirectoryItem = {
				label: path.basename(parentPath),
				description: parentPath,
				fullPath: parentPath,
				itemType: ItemType.Directory,
			};

			// Replace workspace with parent folder
			await this.replaceWorkspaceFolders([parentDirectoryItem]);

			console.log(
				`rip-open: Replaced workspace with parent folder: ${parentPath}`
			);
		} catch (error) {
			console.error(
				`rip-open: Error in replaceWorkspaceWithParentFolder:`,
				error
			);
			await MessageUtils.showError(
				`Failed to replace workspace with parent folder: ${error}`
			);
			throw error;
		}
	}

	/**
	 * Open parent folder of current workspace folder in VS Code
	 */
	static async openParentFolder(): Promise<void> {
		try {
			const result = await this.getParentDirectoryFromWorkspace();
			if (!result) {
				return; // Error already shown or user cancelled
			}

			const { parentPath } = result;

			// Ask user how to open the parent folder
			const openChoice = await vscode.window.showQuickPick(
				[
					{
						label: "Open in Current Window",
						description: "Replace current workspace with parent folder",
					},
					{
						label: "Open in New Window",
						description: "Open parent folder in a new VS Code window",
					},
				],
				{
					placeHolder: `How would you like to open ${path.basename(
						parentPath
					)}?`,
				}
			);

			if (!openChoice) {
				return; // User cancelled
			}
			const forceNewWindow = openChoice.label === "Open in New Window";

			// Open the parent folder using the shared helper
			await this.openSingleDirectory(parentPath, forceNewWindow);

			console.log(
				`rip-open: Opened parent folder in ${
					forceNewWindow ? "new window" : "current window"
				}: ${parentPath}`
			);
		} catch (error) {
			console.error(`rip-open: Error in openParentFolder:`, error);
			await MessageUtils.showError(`Failed to open parent folder: ${error}`);
			throw error;
		}
	}

	/**
	 * Process directory items, extracting paths from workspace files and combining with regular directories
	 */
	private static async processDirectoryItems(items: DirectoryItem[]): Promise<{
		allDirectories: DirectoryItem[];
		extractedPaths: DirectoryItem[];
		allInvalidPaths: string[];
		workspaceFiles: DirectoryItem[];
		totalWorkspacePaths: number;
	}> {
		// Separate workspace files from directories
		const workspaceFiles = items.filter(
			(item) => item.itemType === ItemType.WorkspaceFile
		);
		const directories = items.filter(
			(item) => item.itemType !== ItemType.WorkspaceFile
		);

		// Handle workspace files - extract their folder paths
		const extractedPaths: DirectoryItem[] = [];
		const allInvalidPaths: string[] = [];
		let totalWorkspacePaths = 0;

		if (workspaceFiles.length > 0) {
			for (const workspaceFile of workspaceFiles) {
				try {
					const result = await this.extractPathsFromWorkspaceFile(
						workspaceFile.fullPath
					);
					extractedPaths.push(...result.extractedDirectories);
					allInvalidPaths.push(...result.invalidPaths);
					totalWorkspacePaths += result.totalPaths;
				} catch (error) {
					console.warn(
						`rip-open: Failed to extract paths from ${workspaceFile.fullPath}:`,
						error
					);
					vscode.window.showWarningMessage(
						`Failed to process workspace file: ${path.basename(
							workspaceFile.fullPath
						)}`
					);
				}
			}
		}

		// Combine regular directories with extracted workspace paths
		const allDirectories = [...directories, ...extractedPaths];

		return {
			allDirectories,
			extractedPaths,
			allInvalidPaths,
			workspaceFiles,
			totalWorkspacePaths,
		};
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

	/**
	 * Extract folder paths from a .code-workspace file
	 */
	private static async extractPathsFromWorkspaceFile(
		workspaceFilePath: string
	): Promise<{
		extractedDirectories: DirectoryItem[];
		invalidPaths: string[];
		totalPaths: number;
	}> {
		try {
			const workspaceContent = fs.readFileSync(workspaceFilePath, "utf8");
			const workspaceConfig = JSON.parse(workspaceContent);

			const extractedDirectories: DirectoryItem[] = [];
			const invalidPaths: string[] = [];
			let totalPaths = 0;

			if (workspaceConfig.folders && Array.isArray(workspaceConfig.folders)) {
				const workspaceDir = path.dirname(workspaceFilePath);

				for (const folder of workspaceConfig.folders) {
					if (folder.path && typeof folder.path === "string") {
						totalPaths++;
						let folderPath = folder.path;

						// Handle relative paths by resolving them relative to the workspace file
						if (!path.isAbsolute(folderPath)) {
							folderPath = path.resolve(workspaceDir, folderPath);
						}

						// Verify the path exists
						if (FileUtils.existsSync(folderPath)) {
							const stats = fs.statSync(folderPath);
							if (stats.isDirectory()) {
								extractedDirectories.push({
									label: path.basename(folderPath),
									description: folderPath,
									fullPath: folderPath,
									itemType: ItemType.Directory,
								});
							} else {
								invalidPaths.push(`${folder.path} (not a directory)`);
							}
						} else {
							invalidPaths.push(`${folder.path} (does not exist)`);
						}
					}
				}
			}

			console.log(
				`rip-open: Extracted ${extractedDirectories.length}/${totalPaths} valid paths from workspace file: ${workspaceFilePath}`
			);

			return {
				extractedDirectories,
				invalidPaths,
				totalPaths,
			};
		} catch (error) {
			console.error(
				`rip-open: Error parsing workspace file ${workspaceFilePath}:`,
				error
			);
			throw new Error(`Failed to parse workspace file: ${error}`);
		}
	}

	/**
	 * Create a new folder in the selected directory
	 */
	static async createFolderInDirectory(
		directoryItem: DirectoryItem
	): Promise<void> {
		try {
			// Prompt for folder name
			const folderName = await vscode.window.showInputBox({
				prompt: `Enter name for new folder in ${path.basename(
					directoryItem.fullPath
				)}`,
				placeHolder: "New folder name",
				validateInput: (value: string) => {
					if (!value || value.trim().length === 0) {
						return "Folder name cannot be empty";
					}
					// Check for invalid characters in folder names
					const invalidChars = /[<>:"/\\|?*]/;
					if (invalidChars.test(value)) {
						return "Folder name contains invalid characters";
					}
					return null;
				},
			});

			if (!folderName) {
				return; // User cancelled
			}

			const newFolderPath = path.join(
				directoryItem.fullPath,
				folderName.trim()
			);

			// Check if folder already exists
			if (FileUtils.existsSync(newFolderPath)) {
				await MessageUtils.showError(
					`Folder "${folderName}" already exists in ${path.basename(
						directoryItem.fullPath
					)}`
				);
				return;
			}

			// Create the folder
			await FileUtils.createDirectory(newFolderPath); // Show success message and offer to open
			const openChoice = await vscode.window.showInformationMessage(
				`Created folder "${folderName}" in ${path.basename(
					directoryItem.fullPath
				)}`,
				"Open with Code",
				"Add to Workspace"
			);

			if (openChoice === "Open with Code") {
				await vscode.commands.executeCommand(
					"vscode.openFolder",
					vscode.Uri.file(newFolderPath),
					false // Open in current window
				);
			} else if (openChoice === "Add to Workspace") {
				const newDirectoryItem: DirectoryItem = {
					label: folderName,
					description: newFolderPath,
					fullPath: newFolderPath,
					itemType: ItemType.Directory,
				};
				await this.addDirectoriesToWorkspace([newDirectoryItem]);
			}
		} catch (error) {
			await MessageUtils.showError(`Failed to create folder: ${error}`);
			throw error;
		}
	}

	/**
	 * Open a single directory in VS Code
	 */
	private static async openSingleDirectory(
		directoryPath: string,
		forceNewWindow: boolean = false
	): Promise<void> {
		await vscode.commands.executeCommand(
			"vscode.openFolder",
			vscode.Uri.file(directoryPath),
			forceNewWindow
		);
		const action = forceNewWindow ? "new window" : "current window";
		await this.showTimedInfoMessage(
			`Opened ${path.basename(directoryPath)} in ${action}`
		);
	}

	/**
	 * Get parent directory of a workspace folder, with user selection if multiple folders exist
	 */
	private static async getParentDirectoryFromWorkspace(): Promise<{
		parentPath: string;
		originalPath: string;
	} | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			await MessageUtils.showError("No workspace folders are open");
			return null;
		}

		let selectedFolder: vscode.WorkspaceFolder;

		if (workspaceFolders.length === 1) {
			// Only one workspace folder, use it
			selectedFolder = workspaceFolders[0];
		} else {
			// Multiple workspace folders, prompt user to choose
			const items = workspaceFolders.map((folder) => ({
				label: path.basename(folder.uri.fsPath),
				description: folder.uri.fsPath,
				folder: folder,
			}));

			const choice = await vscode.window.showQuickPick(items, {
				placeHolder: "Select workspace folder to get parent of",
			});

			if (!choice) {
				return null; // User cancelled
			}

			selectedFolder = choice.folder;
		}

		// Get parent directory
		const currentPath = selectedFolder.uri.fsPath;
		const parentPath = path.dirname(currentPath);

		// Check if we're already at the root
		if (parentPath === currentPath) {
			await MessageUtils.showError(
				`Cannot go up from root directory: ${currentPath}`
			);
			return null;
		}

		// Check if parent directory exists
		if (!FileUtils.existsSync(parentPath)) {
			await MessageUtils.showError(
				`Parent directory does not exist: ${parentPath}`
			);
			return null;
		}

		return { parentPath, originalPath: currentPath };
	}
}
