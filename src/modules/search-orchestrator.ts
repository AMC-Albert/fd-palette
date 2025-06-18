import * as vscode from "vscode";
import { CacheManager } from "./cache";
import { DirectorySearcher } from "./directory-search";
import { DirectoryPicker } from "./ui";
import { ConfigurationManager } from "./configuration";
import { DirectoryAction, DirectoryItem, ItemType } from "./types";
import { MessageUtils } from "./utils";

// Module-level storage for move/copy operations
let pendingMoveItems: DirectoryItem[] = [];
let pendingCopyItems: DirectoryItem[] = [];

export class SearchOrchestrator {
	constructor(private cacheManager: CacheManager) {}

	async searchAndAddDirectories(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.AddToWorkspace);
	}

	async searchAndReplaceWorkspace(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.ReplaceWorkspace);
	}

	async searchAndOpenFolder(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.OpenInWindow);
	}

	async searchAndCreateFolder(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.CreateFolder);
	}

	async searchAndPromptForAction(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.PromptForAction);
	}

	private async performDirectorySearch(
		action: DirectoryAction,
		forceNewWindow: boolean = false
	): Promise<void> {
		let searchParams = ConfigurationManager.getSearchParams();

		// For CreateFolder action, exclude workspace files
		if (action === DirectoryAction.CreateFolder) {
			searchParams = {
				...searchParams,
				includeWorkspaceFiles: false,
			};
		}

		// IMPORTANT: Resolve the actual search paths that will be used
		// This ensures the cache key matches the actual search being performed
		const actualSearchPaths = await ConfigurationManager.getValidSearchPaths();
		searchParams = {
			...searchParams,
			searchPath: actualSearchPaths,
		};

		// Check cache first with background refresh capability
		const cachedDirectories = this.cacheManager.getCachedDirectoriesWithRefresh(
			searchParams,
			true
		);
		if (cachedDirectories) {
			// Filter out workspace files for CreateFolder action if they exist in cache
			let directoriesToShow = cachedDirectories;
			if (action === DirectoryAction.CreateFolder) {
				directoriesToShow = cachedDirectories.filter(
					(dir) => dir.itemType !== ItemType.WorkspaceFile
				);
			}

			await DirectoryPicker.showDirectoryPicker(
				directoriesToShow,
				action,
				forceNewWindow,
				this.cacheManager
			);
			return;
		}

		// No cached results found, performing fresh search
		// Check if ripgrep is available
		let rgPath: string;
		try {
			rgPath = await DirectorySearcher.checkRipgrepAvailability();
		} catch (error) {
			await MessageUtils.showError(`ripgrep is not available: ${error}`);
			return;
		}

		// Show a progress indicator while searching
		const actionText =
			action === DirectoryAction.AddToWorkspace
				? "adding to workspace"
				: action === DirectoryAction.ReplaceWorkspace
				? "replacing workspace"
				: action === DirectoryAction.CreateFolder
				? "creating folder"
				: "opening";

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Searching directories for ${actionText}...`,
				cancellable: true,
			},
			async (progress, token) => {
				try {
					let directories: DirectoryItem[];
					let searchMethod = "unknown";

					// Try fzf search first (includes fzf discovery during search)
					try {
						directories = await DirectorySearcher.findDirectoriesWithFzf(
							searchParams,
							token
						);
						searchMethod = "ripgrep + fzf";
					} catch (fzfError) {
						// fzf search failed, fall back to basic ripgrep
						directories = await DirectorySearcher.findDirectories(
							searchParams,
							token
						);
						searchMethod = "ripgrep";
					}

					if (directories.length === 0) {
						const noResultsMessage = `No directories found using ${searchMethod}.`;
						await MessageUtils.showInfo(noResultsMessage);
						setTimeout(() => {
							vscode.commands.executeCommand("workbench.action.closeMessages");
						}, 3000);
						return;
					}

					// Cache the results
					await this.cacheManager.setCachedDirectories(
						searchParams,
						directories
					);

					// Show the directory picker
					await DirectoryPicker.showDirectoryPicker(
						directories,
						action,
						forceNewWindow,
						this.cacheManager
					);
				} catch (error) {
					if (error instanceof Error && error.message.includes("cancelled")) {
						// User cancelled the operation
						return;
					}
					console.error("Error during directory search:", error);
					vscode.window.showErrorMessage(`Search failed: ${error}`);
				}
			}
		);
	}

	async searchForMoveDestination(): Promise<void> {
		const sourceDirectories = (global as any).ripScopeMoveSource;

		if (!sourceDirectories || sourceDirectories.length === 0) {
			await MessageUtils.showError(
				"No source directories found for move operation"
			);
			return;
		}

		await this.performDestinationSearch(
			DirectoryAction.Move,
			sourceDirectories
		);
	}

	async searchForCopyDestination(): Promise<void> {
		const sourceDirectories = (global as any).ripScopeCopySource;

		if (!sourceDirectories || sourceDirectories.length === 0) {
			await MessageUtils.showError(
				"No source directories found for copy operation"
			);
			return;
		}

		await this.performDestinationSearch(
			DirectoryAction.Copy,
			sourceDirectories
		);
	}

	private async performDestinationSearch(
		action: DirectoryAction.Move | DirectoryAction.Copy,
		sourceDirectories: DirectoryItem[]
	): Promise<void> {
		let searchParams = ConfigurationManager.getSearchParams();

		// For destination selection, exclude workspace files
		searchParams = {
			...searchParams,
			includeWorkspaceFiles: false,
		};

		// IMPORTANT: Resolve the actual search paths that will be used
		// This ensures the cache key matches the actual search being performed
		const actualSearchPaths = await ConfigurationManager.getValidSearchPaths();
		searchParams = {
			...searchParams,
			searchPath: actualSearchPaths,
		};

		// Check cache first
		const cachedDirectories = this.cacheManager.getCachedDirectoriesWithRefresh(
			searchParams,
			true
		);
		if (cachedDirectories) {
			// Filter out workspace files
			const validDestinations = cachedDirectories.filter(
				(dir) => dir.itemType !== ItemType.WorkspaceFile
			);
			if (validDestinations.length > 0) {
				await DirectoryPicker.showDestinationPicker(
					validDestinations,
					sourceDirectories,
					action,
					this.cacheManager
				);
				return;
			}
		}

		// Perform fresh search for destinations
		const actionText = action === DirectoryAction.Move ? "move" : "copy";

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Searching for ${actionText} destination...`,
				cancellable: true,
			},
			async (progress, token) => {
				try {
					let directories: DirectoryItem[];

					try {
						directories = await DirectorySearcher.findDirectoriesWithFzf(
							searchParams,
							token
						);
					} catch (fzfError) {
						directories = await DirectorySearcher.findDirectories(
							searchParams,
							token
						);
					}

					// Filter out workspace files
					const validDestinations = directories.filter(
						(dir) => dir.itemType !== ItemType.WorkspaceFile
					);

					if (validDestinations.length === 0) {
						await MessageUtils.showInfo(
							"No valid destination directories found."
						);
						return;
					}

					// Cache the results
					await this.cacheManager.setCachedDirectories(
						searchParams,
						directories
					); // Show destination picker
					await DirectoryPicker.showDestinationPicker(
						validDestinations,
						sourceDirectories,
						action,
						this.cacheManager
					);
				} catch (error) {
					if (error instanceof Error && error.message.includes("cancelled")) {
						return;
					}
					vscode.window.showErrorMessage(`Destination search failed: ${error}`);
				}
			}
		);
	}

	clearCache(): void {
		this.cacheManager.clearCache();
	}
}
