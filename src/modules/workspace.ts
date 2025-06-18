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
			console.log(`rip-scope: ${message}`);

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
			console.error(`rip-scope: Failed to add directories to workspace`);
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
				`Opened ${directories.length} directories in separate windows`
			);
		} else {
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
						"VS Code Workspace": ["code-workspace"],
					},
					saveLabel: "Save Workspace",
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
				`rip-scope: Removed folder from workspace: ${folderToRemove.uri.fsPath}`
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
				`rip-scope: Removed ${workspaceFolders.length} existing workspace folders`
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
				`rip-scope: Starting replaceWorkspaceFolders with ${items.length} items`
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
				`rip-scope: Current workspace has ${currentFolderCount} folders`
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
				console.log(`rip-scope: ${message} - no changes needed`);
				return;
			}

			// Create workspace folder objects for the directories (both regular and extracted)
			const newWorkspaceFolders = allDirectories.map((item) => ({
				uri: vscode.Uri.file(item.fullPath),
			}));

			console.log(
				`rip-scope: Will replace with ${
					allDirectories.length
				} folders: ${allDirectories.map((item) => item.fullPath).join(", ")}`
			);

			// Replace all existing folders with new ones in a single operation
			const success = vscode.workspace.updateWorkspaceFolders(
				0, // start index (remove from beginning)
				currentFolderCount, // delete count (remove all existing)
				...newWorkspaceFolders // add new folders
			);

			console.log(`rip-scope: updateWorkspaceFolders result: ${success}`);

			if (success) {
				let message = `Replaced workspace with ${allDirectories.length} folder(s)`;
				if (workspaceFiles.length > 0) {
					message += ` (${extractedPaths.length} extracted from ${workspaceFiles.length} workspace file(s))`;
				}

				vscode.window.showInformationMessage(message);
				console.log(
					`rip-scope: Completed replaceWorkspaceFolders - ${message}`
				);

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
				console.error(`rip-scope: ${errorMsg}`);
				await MessageUtils.showError(errorMsg);
			}
		} catch (error) {
			console.error(`rip-scope: Error in replaceWorkspaceFolders:`, error);
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
				`rip-scope: Replaced workspace with parent folder: ${parentPath}`
			);
		} catch (error) {
			console.error(
				`rip-scope: Error in replaceWorkspaceWithParentFolder:`,
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
				`rip-scope: Opened parent folder in ${
					forceNewWindow ? "new window" : "current window"
				}: ${parentPath}`
			);
		} catch (error) {
			console.error(`rip-scope: Error in openParentFolder:`, error);
			await MessageUtils.showError(`Failed to open parent folder: ${error}`);
			throw error;
		}
	}

	/**
	 * Close and delete the current workspace file
	 */
	static async closeAndDeleteWorkspace(): Promise<void> {
		const workspaceFile = vscode.workspace.workspaceFile;

		if (!workspaceFile) {
			await MessageUtils.showError("No workspace file is currently open");
			return;
		}

		// Get the workspace file path
		const workspaceFilePath = workspaceFile.fsPath;
		const workspaceFileName = path.basename(workspaceFilePath);

		try {
			// Wait a moment for the new window to open
			setTimeout(async () => {
				try {
					// Delete the workspace file
					const fs = await import("fs/promises");
					await fs.unlink(workspaceFilePath);

					await MessageUtils.showInfo(
						`Workspace file "${workspaceFileName}" has been deleted`
					);
				} catch (error) {
					await MessageUtils.showError(
						`Failed to delete workspace file: ${error}`
					);
				}
			}, 1000);
		} catch (error) {
			await MessageUtils.showError(`Failed to close workspace: ${error}`);
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
						`rip-scope: Failed to extract paths from ${workspaceFile.fullPath}:`,
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
			console.error("rip-scope: Could not determine selected folder:", error);
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
				`rip-scope: Extracted ${extractedDirectories.length}/${totalPaths} valid paths from workspace file: ${workspaceFilePath}`
			);

			return {
				extractedDirectories,
				invalidPaths,
				totalPaths,
			};
		} catch (error) {
			console.error(
				`rip-scope: Error parsing workspace file ${workspaceFilePath}:`,
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
			} // Create the folder
			await FileUtils.createDirectory(newFolderPath);

			// Show success message with action buttons
			await MessageUtils.showFolderActionDialog(
				`Created folder "${folderName}" in ${path.basename(
					directoryItem.fullPath
				)}`,
				newFolderPath,
				async () => {
					const newDirectoryItem: DirectoryItem = {
						label: folderName,
						description: newFolderPath,
						fullPath: newFolderPath,
						itemType: ItemType.Directory,
					};
					await this.addDirectoriesToWorkspace([newDirectoryItem]);
				}
			);
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

	/**
	 * Delete selected directories or workspace files
	 */
	static async deleteDirectories(items: DirectoryItem[]): Promise<void> {
		// Separate workspace files from directories
		const workspaceFiles = items.filter(
			(item) => item.itemType === ItemType.WorkspaceFile
		);
		const directories = items.filter(
			(item) => item.itemType !== ItemType.WorkspaceFile
		);

		const totalCount = items.length;
		const itemText = totalCount === 1 ? "item" : "items";
		const itemNames = items
			.map((item) => path.basename(item.fullPath))
			.join(", ");

		// Confirm with the user
		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to permanently delete ${totalCount} ${itemText}?\n\n${itemNames}\n\nThis action cannot be undone.`,
			{ modal: true },
			"Yes, Delete",
			"Cancel"
		);

		if (confirmation !== "Yes, Delete") {
			return;
		}

		const fs = await import("fs/promises");
		let deletedCount = 0;
		const errors: string[] = [];

		// Delete workspace files
		for (const workspaceFile of workspaceFiles) {
			try {
				await fs.unlink(workspaceFile.fullPath);
				deletedCount++;
			} catch (error) {
				errors.push(`${path.basename(workspaceFile.fullPath)}: ${error}`);
			}
		}

		// Delete directories
		for (const directory of directories) {
			try {
				await fs.rmdir(directory.fullPath, { recursive: true });
				deletedCount++;
			} catch (error) {
				errors.push(`${path.basename(directory.fullPath)}: ${error}`);
			}
		}

		// Show results
		if (errors.length === 0) {
			await MessageUtils.showInfo(
				`Successfully deleted ${deletedCount} ${itemText}`
			);
		} else if (deletedCount > 0) {
			await MessageUtils.showWarning(
				`Deleted ${deletedCount} of ${totalCount} ${itemText}. Errors:\n${errors.join(
					"\n"
				)}`
			);
		} else {
			await MessageUtils.showError(
				`Failed to delete any items:\n${errors.join("\n")}`
			);
		}
	}

	/**
	 * Move directories to a destination
	 */
	static async moveDirectories(
		sourceDirectories: DirectoryItem[],
		destination: DirectoryItem
	): Promise<void> {
		const fs = await import("fs/promises");
		const path = await import("path");

		const sourceNames = sourceDirectories
			.map((dir) => path.basename(dir.fullPath))
			.join(", ");
		const destinationName = path.basename(destination.fullPath);

		const confirmation = await vscode.window.showWarningMessage(
			`Move ${sourceDirectories.length} item(s) (${sourceNames}) to "${destinationName}"?`,
			{ modal: true },
			"Move",
			"Cancel"
		);

		if (confirmation !== "Move") {
			return;
		}
		// Check for recursive move that would cause infinite loop
		const { isRecursive, conflictingPaths } = this.isRecursiveOperation(
			sourceDirectories,
			destination.fullPath,
			true // This is a move operation
		);
		if (isRecursive) {
			const errorMessage = `Cannot move items: ${conflictingPaths.join(", ")}`;
			await MessageUtils.showError(errorMessage);
			return;
		}
		try {
			const results = [];
			const movedItems: DirectoryItem[] = [];
			for (const sourceDir of sourceDirectories) {
				const sourceName = path.basename(sourceDir.fullPath);
				const newPath = path.join(destination.fullPath, sourceName);

				// Check if destination already exists
				try {
					await fs.access(newPath);
					const overwrite = await vscode.window.showWarningMessage(
						`"${sourceName}" already exists in destination. Overwrite?`,
						{ modal: true },
						"Overwrite",
						"Skip",
						"Cancel"
					);

					if (overwrite === "Cancel") {
						return;
					} else if (overwrite === "Skip") {
						continue;
					}
				} catch {
					// Destination doesn't exist, proceed
				}

				// Perform the move operation
				await fs.rename(sourceDir.fullPath, newPath);
				results.push(`${sourceName} → ${destinationName}`);

				// Track the moved item
				movedItems.push({
					label: sourceName,
					description: newPath,
					fullPath: newPath,
					itemType: sourceDir.itemType,
				});
			}
			if (results.length > 0) {
				// Show success message with action buttons
				await MessageUtils.showFolderActionDialog(
					`Moved ${results.length} item(s): ${results.join(", ")}`,
					movedItems,
					async () => {
						await this.addDirectoriesToWorkspace(movedItems);
					}
				);
			}
		} catch (error) {
			await MessageUtils.showError(`Failed to move directories: ${error}`);
		}
	}

	/**
	 * Copy directories to a destination
	 */
	static async copyDirectories(
		sourceDirectories: DirectoryItem[],
		destination: DirectoryItem
	): Promise<void> {
		const fs = await import("fs/promises");
		const path = await import("path");
		const sourceNames = sourceDirectories
			.map((dir) => path.basename(dir.fullPath))
			.join(", ");
		const destinationName = path.basename(destination.fullPath);

		// Check if any sources are being copied within the same directory
		const hasSameDirectoryCopies = sourceDirectories.some(
			(sourceDir) => path.dirname(sourceDir.fullPath) === destination.fullPath
		);

		const confirmationMessage = hasSameDirectoryCopies
			? `Copy ${sourceDirectories.length} item(s) (${sourceNames}) within "${destinationName}" with auto-generated names?`
			: `Copy ${sourceDirectories.length} item(s) (${sourceNames}) to "${destinationName}"?`;

		const confirmation = await vscode.window.showInformationMessage(
			confirmationMessage,
			{ modal: true },
			"Copy",
			"Cancel"
		);

		if (confirmation !== "Copy") {
			return;
		}
		// Check for recursive copy that would cause infinite loop
		const { isRecursive, conflictingPaths } = this.isRecursiveOperation(
			sourceDirectories,
			destination.fullPath,
			false // This is a copy operation
		);
		if (isRecursive) {
			const errorMessage = `Cannot copy items: ${conflictingPaths.join(", ")}`;
			await MessageUtils.showError(errorMessage);
			return;
		}
		try {
			const results = [];
			const copiedItems: DirectoryItem[] = [];
			for (const sourceDir of sourceDirectories) {
				const sourceName = path.basename(sourceDir.fullPath);
				const sourceParent = path.dirname(sourceDir.fullPath);
				const isSameDirectory = sourceParent === destination.fullPath;

				let targetName: string;
				let newPath: string;

				if (isSameDirectory) {
					// Copying within the same directory - generate unique name with suffix
					targetName = await this.generateCopyName(
						sourceDir.fullPath,
						destination.fullPath
					);
					newPath = path.join(destination.fullPath, targetName);
				} else {
					// Copying to different directory - handle conflicts normally
					targetName = sourceName;
					newPath = path.join(destination.fullPath, sourceName);

					// Check if destination already exists
					try {
						await fs.access(newPath);
						const overwrite = await vscode.window.showWarningMessage(
							`"${sourceName}" already exists in destination. Overwrite?`,
							{ modal: true },
							"Overwrite",
							"Skip",
							"Cancel"
						);

						if (overwrite === "Cancel") {
							return;
						} else if (overwrite === "Skip") {
							continue;
						}
					} catch {
						// Destination doesn't exist, proceed
					}
				}

				// Perform the copy operation (recursive copy)
				await this.copyRecursive(sourceDir.fullPath, newPath);
				results.push(`${sourceName} → ${targetName}`);

				// Track the copied item
				copiedItems.push({
					label: targetName,
					description: newPath,
					fullPath: newPath,
					itemType: sourceDir.itemType,
				});
			}
			if (results.length > 0) {
				// Show success message with action buttons
				await MessageUtils.showFolderActionDialog(
					`Copied ${results.length} item(s): ${results.join(", ")}`,
					copiedItems,
					async () => {
						await this.addDirectoriesToWorkspace(copiedItems);
					}
				);
			}
		} catch (error) {
			await MessageUtils.showError(`Failed to copy directories: ${error}`);
		}
	}

	/**
	 * Recursively copy a directory
	 */
	private static async copyRecursive(
		source: string,
		destination: string
	): Promise<void> {
		const fs = await import("fs/promises");
		const path = await import("path");

		const stats = await fs.stat(source);

		if (stats.isDirectory()) {
			// Create destination directory
			await fs.mkdir(destination, { recursive: true });

			// Copy all contents
			const entries = await fs.readdir(source);
			for (const entry of entries) {
				const sourcePath = path.join(source, entry);
				const destPath = path.join(destination, entry);
				await this.copyRecursive(sourcePath, destPath);
			}
		} else {
			// Copy file
			await fs.copyFile(source, destination);
		}
	}

	/**
	 * Check if a move/copy operation would create infinite recursion
	 */
	private static isRecursiveOperation(
		sourceItems: DirectoryItem[],
		destinationPath: string,
		isMovingOperation: boolean = false
	): { isRecursive: boolean; conflictingPaths: string[] } {
		const path = require("path");
		const conflictingPaths: string[] = [];

		for (const sourceItem of sourceItems) {
			const sourcePath = sourceItem.fullPath;
			const normalizedSource = path.resolve(sourcePath).replace(/[\\\/]+$/, ""); // Remove trailing slashes
			const normalizedDestination = path
				.resolve(destinationPath)
				.replace(/[\\\/]+$/, "");

			// Check if trying to copy/move into itself
			if (normalizedSource === normalizedDestination) {
				conflictingPaths.push(
					`Cannot move/copy "${path.basename(sourcePath)}" into itself`
				);
				continue;
			}

			// Check if destination is inside source (would create infinite recursion)
			// This handles cases like moving /parent into /parent/child
			const sourcePlusSep = normalizedSource + path.sep;
			if (normalizedDestination.startsWith(sourcePlusSep)) {
				const relativePath = path.relative(sourcePath, destinationPath);
				conflictingPaths.push(
					`Cannot move/copy "${path.basename(
						sourcePath
					)}" into its subdirectory "${relativePath}"`
				);
				continue;
			}

			// Check if source is being moved/copied into its own parent with same name (would overwrite itself)
			const sourceParent = path.dirname(normalizedSource);
			const sourceName = path.basename(normalizedSource);
			const targetPath = path.join(normalizedDestination, sourceName);

			if (normalizedSource === path.resolve(targetPath)) {
				// For copy operations within the same directory, allow it (will be handled with suffix)
				// For move operations, this is an error
				if (isMovingOperation) {
					conflictingPaths.push(
						`Cannot move "${sourceName}" to the same location`
					);
				}
				// For copy operations, this is allowed and will be handled by generateCopyName
			}
		}

		return {
			isRecursive: conflictingPaths.length > 0,
			conflictingPaths,
		};
	}

	/**
	 * Generate a unique copy name by adding or incrementing a suffix
	 */
	private static async generateCopyName(
		originalPath: string,
		destinationDir: string
	): Promise<string> {
		const fs = await import("fs/promises");
		const path = await import("path");

		const originalName = path.basename(originalPath);
		const baseDestPath = path.join(destinationDir, originalName);

		// If the destination doesn't exist, use the original name
		try {
			await fs.access(baseDestPath);
		} catch {
			return originalName;
		}

		// Extract base name and existing suffix if any
		const copyRegex = /^(.+?)(_copy(\d{3}))?$/;
		const match = originalName.match(copyRegex);
		const baseName = match ? match[1] : originalName;

		// Find the next available number
		let copyNumber = 1;
		let newName: string;
		let newPath: string;

		do {
			const suffix = `_copy${String(copyNumber).padStart(3, "0")}`;
			newName = `${baseName}${suffix}`;
			newPath = path.join(destinationDir, newName);

			try {
				await fs.access(newPath);
				copyNumber++;
			} catch {
				// Path doesn't exist, we can use this name
				break;
			}
		} while (copyNumber <= 999); // Prevent infinite loop

		if (copyNumber > 999) {
			throw new Error(
				`Cannot generate unique copy name: too many copies of "${baseName}"`
			);
		}

		return newName;
	}
}
