import * as vscode from 'vscode';
import { CacheManager } from './cache';
import { DirectorySearcher } from './directory-search';
import { DirectoryPicker } from './ui';
import { ConfigurationManager } from './configuration';

export class SearchOrchestrator {
	constructor(private cacheManager: CacheManager) {}

	async searchAndAddDirectories(): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();

		// Check cache first
		const cachedDirectories = this.cacheManager.getCachedDirectories(searchParams);
		if (cachedDirectories) {
			vscode.window.showInformationMessage(`Using cached results (${cachedDirectories.length} directories)`);
			await DirectoryPicker.showDirectoryPicker(cachedDirectories, 'memory');
			return;
		}

		// First check if fd is available
		try {
			await DirectorySearcher.checkFdAvailability(searchParams.fdPath);
		} catch (error) {
			vscode.window.showErrorMessage(`fd is not available: ${error}`);
			return;
		}

		// Show a progress indicator while searching
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Searching directories with fd...",
			cancellable: true
		}, async (progress, token) => {
			
			try {
				const directories = await DirectorySearcher.findDirectories(searchParams, token);
				
				if (directories.length === 0) {
					vscode.window.showInformationMessage('No directories found.');
					return;
				}

				// Cache the results
				await this.cacheManager.setCachedDirectories(searchParams, directories);

				await DirectoryPicker.showDirectoryPicker(directories);

			} catch (error) {
				vscode.window.showErrorMessage(`Error searching directories: ${error}`);
			}
		});
	}

	async checkFdInstallation(): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();
		await DirectorySearcher.checkFdInstallation(searchParams.fdPath);
	}

	clearCache(): void {
		this.cacheManager.clearCache();
	}
}
