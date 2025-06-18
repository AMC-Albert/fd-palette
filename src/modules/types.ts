import * as vscode from "vscode";

export enum ItemType {
	Directory = "directory",
	WorkspaceFile = "workspaceFile",
}

export interface DirectoryItem extends vscode.QuickPickItem {
	fullPath: string;
	itemType?: ItemType;
}

export interface CacheEntry {
	directories: DirectoryItem[];
	timestamp: number;
	searchParams: string;
	version: number;
}

export interface SearchParams {
	searchPath: string[];
	excludePatterns: string[];
	ripgrepPath: string;
	fzfPath: string;
	fzfOptions: string;
	fzfFilterArgs: string;
	fzfRankingArgs: string;
	additionalRipgrepArgs: string[];
	boostGitDirectories: boolean;
	includeWorkspaceFiles: boolean;
}

export enum DirectoryAction {
	AddToWorkspace = "addToWorkspace",
	ReplaceWorkspace = "replaceWorkspace",
	OpenInWindow = "openInWindow",
	CreateFolder = "createFolder",
}
