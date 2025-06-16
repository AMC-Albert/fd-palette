import * as vscode from 'vscode';
import { DirectoryItem, CacheSource } from './types';
import { WorkspaceManager } from './workspace';

export class DirectoryPicker {
	static async showDirectoryPicker(directories: DirectoryItem[], cacheSource?: CacheSource): Promise<void> {
		const quickPick = vscode.window.createQuickPick<DirectoryItem>();
		quickPick.items = directories;
		quickPick.canSelectMany = true;
		quickPick.matchOnDescription = true;
		
		// Set up dynamic placeholder
		const updatePlaceholder = () => {
			const searchTerm = quickPick.value.trim();
			const cacheInfo = cacheSource ? ` (${cacheSource} cache)` : '';
			if (searchTerm === '') {
				quickPick.placeholder = `Search ${directories.length} directories${cacheInfo} (type to filter, Enter to add)`;
			} else {
				quickPick.placeholder = `Filtered results${cacheInfo} (Enter to add highlighted, Space for multiple)`;
			}
		};

		// Handle value changes
		quickPick.onDidChangeValue(() => {
			updatePlaceholder();
		});

		// Handle acceptance
		quickPick.onDidAccept(async () => {
			const selectedItems = [...quickPick.selectedItems];
			
			let itemsToAdd: DirectoryItem[] = [];
			
			if (selectedItems.length > 0) {
				// User explicitly selected items (using Space or checkboxes)
				itemsToAdd = selectedItems;
			} else if (quickPick.activeItems.length > 0) {
				// No explicit selection, use the active/highlighted item
				itemsToAdd = [quickPick.activeItems[0]];
			}
			
			if (itemsToAdd.length > 0) {
				try {
					await WorkspaceManager.addDirectoriesToWorkspace(itemsToAdd);
				} catch (error) {
					vscode.window.showErrorMessage(`Error adding directories: ${error}`);
				}
			} else {
				vscode.window.showInformationMessage('No directory selected.');
			}
			
			quickPick.dispose();
		});

		// Handle hiding/cancellation
		quickPick.onDidHide(() => {
			quickPick.dispose();
		});

		// Set initial placeholder and show
		updatePlaceholder();
		quickPick.show();
	}
}
