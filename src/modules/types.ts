import * as vscode from 'vscode';

export interface DirectoryItem extends vscode.QuickPickItem {
	fullPath: string;
}

export interface CacheEntry {
	directories: DirectoryItem[];
	timestamp: number;
	searchParams: string;
	version: number;
}

export interface SearchParams {	searchPath: string;
	maxDepth: number;
	excludePatterns: string[];
	fdPath: string;
}

export enum DirectoryAction {
	AddToWorkspace = 'addToWorkspace',
	openInWindow = 'openInWindow'
}
