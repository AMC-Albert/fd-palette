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
	console.log("rip-scope extension is now active!");

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
		"rip-scope.addToWorkspace",
		async () => {
			await searchOrchestrator.searchAndAddDirectories();
		}
	);
	const replaceWorkspaceCommand = vscode.commands.registerCommand(
		"rip-scope.replaceWorkspace",
		async () => {
			await searchOrchestrator.searchAndReplaceWorkspace();
		}
	);
	const createFolderCommand = vscode.commands.registerCommand(
		"rip-scope.createFolder",
		async () => {
			await searchOrchestrator.searchAndCreateFolder();
		}
	);

	const openFolderCommand = vscode.commands.registerCommand(
		"rip-scope.openFolder",
		async () => {
			await searchOrchestrator.searchAndOpenFolder();
		}
	);

	const clearCacheCommand = vscode.commands.registerCommand(
		"rip-scope.clearCache",
		async () => {
			cacheManager.clearCache();
		}
	);
	const resetSettingsCommand = vscode.commands.registerCommand(
		"rip-scope.resetSettings",
		async () => {
			await ConfigurationManager.resetSettingsToDefault();
		}
	);
	const removeSelectedFolderCommand = vscode.commands.registerCommand(
		"rip-scope.removeSelectedFolder",
		async () => {
			await WorkspaceManager.removeSelectedFolder();
		}
	);
	const replaceWithParentCommand = vscode.commands.registerCommand(
		"rip-scope.replaceWithParentFolder",
		async () => {
			await WorkspaceManager.replaceWorkspaceWithParentFolder();
		}
	);

	const openParentFolderCommand = vscode.commands.registerCommand(
		"rip-scope.openParentFolder",
		async () => {
			await WorkspaceManager.openParentFolder();
		}
	);
	const unifiedSearchCommand = vscode.commands.registerCommand(
		"rip-scope.unifiedSearch",
		async () => {
			await searchOrchestrator.searchAndPromptForAction();
		}
	);
	const closeAndDeleteWorkspaceCommand = vscode.commands.registerCommand(
		"rip-scope.closeAndDeleteWorkspace",
		async () => {
			await WorkspaceManager.closeAndDeleteWorkspace();
		}
	);
	const selectMoveDestinationCommand = vscode.commands.registerCommand(
		"rip-scope.selectMoveDestination",
		async () => {
			console.log("rip-scope: selectMoveDestination command executed");
			await searchOrchestrator.searchForMoveDestination();
		}
	);
	const selectCopyDestinationCommand = vscode.commands.registerCommand(
		"rip-scope.selectCopyDestination",
		async () => {
			console.log("rip-scope: selectCopyDestination command executed");
			await searchOrchestrator.searchForCopyDestination();
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
		closeAndDeleteWorkspaceCommand,
		selectMoveDestinationCommand,
		selectCopyDestinationCommand
	);
}

export function deactivate() {
	// Cleanup background refresh timers
	if (cacheManager) {
		cacheManager.dispose();
	}
}
