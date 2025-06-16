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

	async searchAndOpenInWindow(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.OpenInWindow);
	}

	private async performDirectorySearch(action: DirectoryAction): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();

		// Check cache first with background refresh capability
		const cachedDirectories = this.cacheManager.getCachedDirectoriesWithRefresh(
			searchParams,
			true
		);
		if (cachedDirectories) {
			console.log(
				`fd-palette: Using cached results (${cachedDirectories.length} directories) - background refresh may be triggered`
			);
			await DirectoryPicker.showDirectoryPicker(cachedDirectories, action);
			return;
		}

		console.log("fd-palette: No cached results found, performing fresh search");

		// Check if ripgrep is available
		let rgPath: string;
		try {
			rgPath = await DirectorySearcher.checkRipgrepAvailability();
			console.log(`fd-palette: Using ripgrep at: ${rgPath}`);
		} catch (error) {
			vscode.window.showErrorMessage(`ripgrep is not available: ${error}`);
			return;
		}

		// Check if fzf is available and enabled
		let useFzf = false;
		if (searchParams.enableFzf) {
			try {
				await DirectorySearcher.checkFzfAvailability(searchParams.fzfPath);
				useFzf = true;
				console.log(
					"fd-palette: fzf is available, will use enhanced ripgrep + fzf search"
				);
			} catch (error) {
				console.log(
					"fd-palette: fzf not available, using basic ripgrep search"
				);
				useFzf = false;
			}
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
						vscode.window.showInformationMessage(noResultsMessage);
						return;
					}

					// Cache the results
					await this.cacheManager.setCachedDirectories(
						searchParams,
						directories
					);

					// Show the directory picker
					await DirectoryPicker.showDirectoryPicker(directories, action);
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

	async checkFzfInstallation(): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();
		try {
			await DirectorySearcher.checkFzfAvailability(searchParams.fzfPath);
			vscode.window.showInformationMessage(
				`fzf is installed and working correctly at: ${searchParams.fzfPath}`
			);
		} catch (error) {
			vscode.window.showErrorMessage(`fzf is not available: ${error}`);
		}
	}

	clearCache(): void {
		this.cacheManager.clearCache();
	}
}
