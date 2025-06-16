import * as vscode from "vscode";
import {
	SearchOrchestrator,
	CacheManager,
	ConfigurationManager,
	DirectorySearcher,
} from "./modules";

let searchOrchestrator: SearchOrchestrator;
let cacheManager: CacheManager;

export function activate(context: vscode.ExtensionContext) {
	console.log("rip-open extension is now active!");

	// Set extension context for DirectorySearcher (needed for caching)
	DirectorySearcher.setExtensionContext(context);

	// Set extension context for ConfigurationManager (needed for path validation caching)
	ConfigurationManager.setExtensionContext(context);

	// Initialize services
	const configManager = new ConfigurationManager();
	cacheManager = new CacheManager(context);
	searchOrchestrator = new SearchOrchestrator(cacheManager); // Start cache preloading in background
	cacheManager.preloadCacheInBackground();

	// Register commands
	const addToWorkspaceCommand = vscode.commands.registerCommand(
		"rip-open.addToWorkspace",
		async () => {
			await searchOrchestrator.searchAndAddDirectories();
		}
	);

	const openInCurrentWindowCommand = vscode.commands.registerCommand(
		"rip-open.openInCurrentWindow",
		async () => {
			await searchOrchestrator.searchAndOpenInCurrentWindow();
		}
	);

	const openInNewWindowCommand = vscode.commands.registerCommand(
		"rip-open.openInNewWindow",
		async () => {
			await searchOrchestrator.searchAndOpenInNewWindow();
		}
	);

	const clearCacheCommand = vscode.commands.registerCommand(
		"rip-open.clearCache",
		async () => {
			cacheManager.clearCache();
		}
	);

	const resetSettingsCommand = vscode.commands.registerCommand(
		"rip-open.resetSettings",
		async () => {
			await ConfigurationManager.resetSettingsToDefault();
		}
	);

	context.subscriptions.push(
		addToWorkspaceCommand,
		openInCurrentWindowCommand,
		openInNewWindowCommand,
		clearCacheCommand,
		resetSettingsCommand
	);
}

export function deactivate() {
	// Cleanup background refresh timers
	if (cacheManager) {
		cacheManager.dispose();
	}
}
