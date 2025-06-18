import * as vscode from "vscode";
import {
	SearchOrchestrator,
	CacheManager,
	ConfigurationManager,
	DirectorySearcher,
	WorkspaceManager,
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
	searchOrchestrator = new SearchOrchestrator(cacheManager);
	// Start cache preloading in background
	cacheManager.preloadCacheInBackground();

	// Register commands
	const addToWorkspaceCommand = vscode.commands.registerCommand(
		"rip-open.addToWorkspace",
		async () => {
			await searchOrchestrator.searchAndAddDirectories();
		}
	);
	const replaceWorkspaceCommand = vscode.commands.registerCommand(
		"rip-open.replaceWorkspace",
		async () => {
			await searchOrchestrator.searchAndReplaceWorkspace();
		}
	);
	const createFolderCommand = vscode.commands.registerCommand(
		"rip-open.createFolder",
		async () => {
			await searchOrchestrator.searchAndCreateFolder();
		}
	);

	const openFolderCommand = vscode.commands.registerCommand(
		"rip-open.openFolder",
		async () => {
			await searchOrchestrator.searchAndOpenFolder();
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
	const removeSelectedFolderCommand = vscode.commands.registerCommand(
		"rip-open.removeSelectedFolder",
		async () => {
			await WorkspaceManager.removeSelectedFolder();
		}
	);
	const replaceWithParentCommand = vscode.commands.registerCommand(
		"rip-open.replaceWithParentFolder",
		async () => {
			await WorkspaceManager.replaceWorkspaceWithParentFolder();
		}
	);

	const openParentFolderCommand = vscode.commands.registerCommand(
		"rip-open.openParentFolder",
		async () => {
			await WorkspaceManager.openParentFolder();
		}
	);
	const unifiedSearchCommand = vscode.commands.registerCommand(
		"rip-open.unifiedSearch",
		async () => {
			await searchOrchestrator.searchAndPromptForAction();
		}
	);
	const closeAndDeleteWorkspaceCommand = vscode.commands.registerCommand(
		"rip-open.closeAndDeleteWorkspace",
		async () => {
			await WorkspaceManager.closeAndDeleteWorkspace();
		}
	);
	context.subscriptions.push(
		addToWorkspaceCommand,
		replaceWorkspaceCommand,
		createFolderCommand,
		openFolderCommand,
		clearCacheCommand,
		resetSettingsCommand,
		removeSelectedFolderCommand,
		replaceWithParentCommand,
		openParentFolderCommand,
		unifiedSearchCommand,
		closeAndDeleteWorkspaceCommand
	);
}

export function deactivate() {
	// Cleanup background refresh timers
	if (cacheManager) {
		cacheManager.dispose();
	}
}
