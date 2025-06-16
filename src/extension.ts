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
	console.log("fd-palette extension is now active!");

	// Set extension context for DirectorySearcher (needed for caching)
	DirectorySearcher.setExtensionContext(context);

	// Set extension context for ConfigurationManager (needed for path validation caching)
	ConfigurationManager.setExtensionContext(context);

	// Initialize services
	const configManager = new ConfigurationManager();
	cacheManager = new CacheManager(context);
	searchOrchestrator = new SearchOrchestrator(cacheManager);
	// Start cache preloading in background
	cacheManager.preloadCacheInBackground();

	// Register commands
	const addToWorkspaceCommand = vscode.commands.registerCommand(
		"fd-palette.addToWorkspace",
		async () => {
			await searchOrchestrator.searchAndAddDirectories();
		}
	);

	const openInWindowCommand = vscode.commands.registerCommand(
		"fd-palette.openInWindow",
		async () => {
			await searchOrchestrator.searchAndOpenInWindow();
		}
	);
	const clearCacheCommand = vscode.commands.registerCommand(
		"fd-palette.clearCache",
		async () => {
			cacheManager.clearCache();
		}
	);
	const resetSettingsCommand = vscode.commands.registerCommand(
		"fd-palette.resetSettings",
		async () => {
			await ConfigurationManager.resetSettingsToDefault();
		}
	);

	const checkFzfCommand = vscode.commands.registerCommand(
		"fd-palette.checkFzfInstallation",
		async () => {
			await searchOrchestrator.checkFzfInstallation();
		}
	);

	context.subscriptions.push(
		addToWorkspaceCommand,
		openInWindowCommand,
		clearCacheCommand,
		resetSettingsCommand,
		checkFzfCommand
	);
}

export function deactivate() {
	// Cleanup background refresh timers
	if (cacheManager) {
		cacheManager.dispose();
	}
}
