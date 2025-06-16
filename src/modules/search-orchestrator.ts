import * as vscode from 'vscode';
import { CacheManager } from './cache';
import { DirectorySearcher } from './directory-search';
import { DirectoryPicker } from './ui';
import { ConfigurationManager } from './configuration';
import { DirectoryAction } from './types';

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
		
		// Check cache first
		const cachedDirectories = this.cacheManager.getCachedDirectories(searchParams);
		if (cachedDirectories) {
			await DirectoryPicker.showDirectoryPicker(cachedDirectories, action);
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
		const actionText = action === DirectoryAction.AddToWorkspace ? 'adding to workspace' : 'opening in window';
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Searching directories with fd for ${actionText}...`,
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

				await DirectoryPicker.showDirectoryPicker(directories, action);

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
