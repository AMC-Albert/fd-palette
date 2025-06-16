import * as vscode from 'vscode';
import { SearchOrchestrator, CacheManager, ConfigurationManager, DirectorySearcher } from './modules';

let searchOrchestrator: SearchOrchestrator;
let cacheManager: CacheManager;

export function activate(context: vscode.ExtensionContext) {
	console.log('fd-palette extension is now active!');
	
	// Set extension context for DirectorySearcher (needed for caching)
	DirectorySearcher.setExtensionContext(context);
	
	// Initialize services
	const configManager = new ConfigurationManager();
	cacheManager = new CacheManager(context);
	searchOrchestrator = new SearchOrchestrator(cacheManager);

	// Start cache preloading in background
	cacheManager.preloadCacheInBackground();	// Register commands
	const addToWorkspaceCommand = vscode.commands.registerCommand('fd-palette.addToWorkspace', async () => {
		const commandStartTime = Date.now();
		console.log('fd-palette: Command addToWorkspace started');
		await searchOrchestrator.searchAndAddDirectories();
		console.log(`fd-palette: Command addToWorkspace completed in ${Date.now() - commandStartTime}ms`);
	});
	const openInWindowCommand = vscode.commands.registerCommand('fd-palette.openInWindow', async () => {
		const commandStartTime = Date.now();
		console.log('fd-palette: Command openInWindow started');
		await searchOrchestrator.searchAndopenInWindow();
		console.log(`fd-palette: Command openInWindow completed in ${Date.now() - commandStartTime}ms`);
	});

	const checkFdCommand = vscode.commands.registerCommand('fd-palette.checkFdInstallation', async () => {
		await searchOrchestrator.checkFdInstallation();
	});
	
	const checkFzfCommand = vscode.commands.registerCommand('fd-palette.checkFzfInstallation', async () => {
		await searchOrchestrator.checkFzfInstallation();
	});

	const clearCacheCommand = vscode.commands.registerCommand('fd-palette.clearCache', async () => {
		cacheManager.clearCache();
	});

	const showCacheStatusCommand = vscode.commands.registerCommand('fd-palette.showCacheStatus', async () => {
		const status = cacheManager.getCacheStatus();
		vscode.window.showInformationMessage(
			`Cache Status: ${status.memoryEntries} in memory, ${status.diskEntries} in globalState, ${status.fileEntries} in files`
		);
	});

	const resetSettingsCommand = vscode.commands.registerCommand('fd-palette.resetSettings', async () => {
		await ConfigurationManager.resetSettingsToDefault();
	});

	context.subscriptions.push(addToWorkspaceCommand, openInWindowCommand, checkFdCommand, checkFzfCommand, clearCacheCommand, showCacheStatusCommand, resetSettingsCommand);
}

export function deactivate() {
	// Cleanup if needed
}
