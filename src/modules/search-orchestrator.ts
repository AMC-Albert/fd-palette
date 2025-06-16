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

	async searchAndopenInWindow(): Promise<void> {
		await this.performDirectorySearch(DirectoryAction.openInWindow);
	}
	private async performDirectorySearch(action: DirectoryAction): Promise<void> {
		const startTime = Date.now();
		const searchParams = ConfigurationManager.getSearchParams();
		
		// Check cache first
		const cacheStartTime = Date.now();
		const cachedDirectories = this.cacheManager.getCachedDirectories(searchParams);
		const cacheTime = Date.now() - cacheStartTime;

		if (cachedDirectories) {
			console.log(`fd-palette: Cache hit - found ${cachedDirectories.length} directories in ${cacheTime}ms`);
			const uiStartTime = Date.now();
			console.log('fd-palette: About to call DirectoryPicker.showDirectoryPicker...');
			await DirectoryPicker.showDirectoryPicker(cachedDirectories, action);
			const uiTime = Date.now() - uiStartTime;
			const totalTime = Date.now() - startTime;
			console.log(`fd-palette: UI display took ${uiTime}ms, total time ${totalTime}ms`);
			return;
		}

		console.log(`fd-palette: Cache miss - took ${cacheTime}ms to check`);
		// First check if fd is available
		const fdCheckStartTime = Date.now();
		try {
			await DirectorySearcher.checkFdAvailability(searchParams.fdPath);
		} catch (error) {
			vscode.window.showErrorMessage(`fd is not available: ${error}`);
			return;
		}
		const fdCheckTime = Date.now() - fdCheckStartTime;
		console.log(`fd-palette: fd availability check took ${fdCheckTime}ms`);

		// Check if fzf is available and enabled
		let useFzf = false;
		if (searchParams.enableFzf) {
			const fzfCheckStartTime = Date.now();
			try {
				await DirectorySearcher.checkFzfAvailability(searchParams.fzfPath);
				useFzf = true;
				console.log(`fd-palette: fzf is available and will be used`);
			} catch (error) {
				console.log(`fd-palette: fzf is not available, falling back to fd only: ${error}`);
				useFzf = false;
			}
			const fzfCheckTime = Date.now() - fzfCheckStartTime;
			console.log(`fd-palette: fzf availability check took ${fzfCheckTime}ms`);
		}		// Show a progress indicator while searching
		const actionText = action === DirectoryAction.AddToWorkspace ? 'adding to workspace' : 'opening';
		const searchMethod = useFzf ? 'fd + fzf' : 'fd';
		const progressStartTime = Date.now();
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Searching directories with ${searchMethod} for ${actionText}...`,
			cancellable: true		}, async (progress, token) => {
			const progressSetupTime = Date.now() - progressStartTime;
			console.log(`fd-palette: Progress notification setup took ${progressSetupTime}ms`);
			
			try {
				const searchStartTime = Date.now();
				
				// Use fzf if available, otherwise fall back to fd only
				const directories = useFzf 
					? await DirectorySearcher.findDirectoriesWithFzf(searchParams, token)
					: await DirectorySearcher.findDirectories(searchParams, token);
				
				const searchTime = Date.now() - searchStartTime;
				
				if (directories.length === 0) {
					const noResultsMessage = useFzf 
						? 'No directories selected from fzf search.' 
						: 'No directories found.';
					vscode.window.showInformationMessage(noResultsMessage);
					return;
				}				console.log(`fd-palette: ${searchMethod} search found ${directories.length} directories in ${searchTime}ms`);

				// Cache the results (using the same cache key since both methods return compatible results)
				const cacheStartTime = Date.now();
				await this.cacheManager.setCachedDirectories(searchParams, directories);
				const cacheTime = Date.now() - cacheStartTime;
				console.log(`fd-palette: Caching took ${cacheTime}ms`);

				const uiStartTime = Date.now();
				await DirectoryPicker.showDirectoryPicker(directories, action);
				const uiTime = Date.now() - uiStartTime;
				const totalTime = Date.now() - startTime;
				console.log(`fd-palette: UI display took ${uiTime}ms, total time ${totalTime}ms`);

			} catch (error) {
				vscode.window.showErrorMessage(`Error searching directories: ${error}`);
			}
		});
	}

	async checkFdInstallation(): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();
		await DirectorySearcher.checkFdInstallation(searchParams.fdPath);
	}

	async checkFzfInstallation(): Promise<void> {
		const searchParams = ConfigurationManager.getSearchParams();
		await DirectorySearcher.checkFzfInstallation(searchParams.fzfPath);
	}

	clearCache(): void {
		this.cacheManager.clearCache();
	}
}
