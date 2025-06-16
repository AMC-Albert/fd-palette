import * as vscode from 'vscode';
import { SearchOrchestrator, CacheManager, ConfigurationManager } from './modules';

let searchOrchestrator: SearchOrchestrator;
let cacheManager: CacheManager;

export function activate(context: vscode.ExtensionContext) {
	console.log('fd-palette extension is now active!');
	// Initialize services
	const configManager = new ConfigurationManager();
	cacheManager = new CacheManager(context);
	searchOrchestrator = new SearchOrchestrator(cacheManager);

	// Start cache preloading in background
	cacheManager.preloadCacheInBackground();
	// Register commands
	const addToWorkspaceCommand = vscode.commands.registerCommand('fd-palette.addToWorkspace', async () => {
		await searchOrchestrator.searchAndAddDirectories();
	});
	const openInWindowCommand = vscode.commands.registerCommand('fd-palette.openInWindow', async () => {
		await searchOrchestrator.searchAndOpenInWindow();
	});

	const checkFdCommand = vscode.commands.registerCommand('fd-palette.checkFdInstallation', async () => {
		await searchOrchestrator.checkFdInstallation();
	});
	const clearCacheCommand = vscode.commands.registerCommand('fd-palette.clearCache', async () => {
		cacheManager.clearCache();
	});

	const resetSettingsCommand = vscode.commands.registerCommand('fd-palette.resetSettings', async () => {
		await ConfigurationManager.resetSettingsToDefault();
	});

	context.subscriptions.push(addToWorkspaceCommand, openInWindowCommand, checkFdCommand, clearCacheCommand, resetSettingsCommand);
}

export function deactivate() {
	// Cleanup if needed
}
