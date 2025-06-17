import * as vscode from "vscode";
import { CacheManager } from "./cache";
import { DirectorySearcher } from "./directory-search";
import { DirectoryPicker } from "./ui";
import { ConfigurationManager } from "./configuration";
import { DirectoryAction, DirectoryItem } from "./types";

export class SearchOrchestrator {
	constructor(private cacheManager: CacheManager) {}
	async searchAndAddDirectories(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.AddToWorkspace);
	}

	async searchAndOpenInCurrentWindow(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.OpenInWindow, false);
	}

	async searchAndOpenInNewWindow(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.OpenInWindow, true);
	}

	private async performDirectorySearch(
		action: DirectoryAction,
		forceNewWindow: boolean = false
	): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();

		// Check cache first with background refresh capability
		const cachedDirectories = this.cacheManager.getCachedDirectoriesWithRefresh(
			searchParams,
			true
		);
		if (cachedDirectories) {
			// Using cached results - reduced logging verbosity
			await DirectoryPicker.showDirectoryPicker(
				cachedDirectories,
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
			// Reduced logging verbosity
		} catch (error) {
			vscode.window.showErrorMessage(`ripgrep is not available: ${error}`);
			return;
		}
		// Check if fzf is available
		let useFzf = false;
		try {
			await DirectorySearcher.checkFzfAvailability(searchParams.fzfPath);
			useFzf = true;
			// Reduced logging verbosity
		} catch (error) {
			// fzf not available, using basic ripgrep search
			useFzf = false;
		}

		// Show a progress indicator while searching
		const actionText =
			action === DirectoryAction.AddToWorkspace
				? "adding to workspace"
				: "opening";
		const searchMethodName = useFzf ? "ripgrep + fzf" : "ripgrep";
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Searching directories with ${searchMethodName} for ${actionText}...`,
				cancellable: true,
			},
			async (progress, token) => {
				try {
					// Use ripgrep with or without fzf
					const directories = useFzf
						? await DirectorySearcher.findDirectoriesWithFzf(
								searchParams,
								token
						  )
						: await DirectorySearcher.findDirectories(searchParams, token);
					if (directories.length === 0) {
						const noResultsMessage = `No directories found using ${searchMethodName}.`;
						vscode.window.showInformationMessage(noResultsMessage, {
							modal: false,
						});
						setTimeout(() => {
							vscode.commands.executeCommand("workbench.action.closeMessages");
						}, 3000);
						return;
					}

					// Cache the results
					await this.cacheManager.setCachedDirectories(
						searchParams,
						directories
					); // Show the directory picker
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

	clearCache(): void {
		this.cacheManager.clearCache();
	}
}
