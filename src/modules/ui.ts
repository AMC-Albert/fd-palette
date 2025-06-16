import * as vscode from 'vscode';
import { DirectoryItem, DirectoryAction } from './types';
import { WorkspaceManager } from './workspace';

export class DirectoryPicker {
	static async showDirectoryPicker(directories: DirectoryItem[], action: DirectoryAction = DirectoryAction.AddToWorkspace): Promise<void> {
		const quickPick = vscode.window.createQuickPick<DirectoryItem>();
		quickPick.items = directories;
		quickPick.canSelectMany = action === DirectoryAction.AddToWorkspace; // Allow multiple selection for workspace
		quickPick.matchOnDescription = true;
				// Set up dynamic placeholder based on action
		const updatePlaceholder = () => {
			const searchTerm = quickPick.value.trim();
			const actionText = action === DirectoryAction.AddToWorkspace ? 'add to workspace' : 'open in window';
			
			if (searchTerm === '') {
				quickPick.placeholder = `Search ${directories.length} directories (type to filter, Enter to ${actionText})`;
			} else {
				const multipleText = action === DirectoryAction.AddToWorkspace ? ', Space for multiple' : '';
				quickPick.placeholder = `Filtered results (Enter to ${actionText}${multipleText})`;
			}
		};

		// Handle value changes
		quickPick.onDidChangeValue(() => {
			updatePlaceholder();
		});
		// Handle acceptance
		quickPick.onDidAccept(async () => {
			const selectedItems = [...quickPick.selectedItems];
			
			let itemsToProcess: DirectoryItem[] = [];
			
			if (selectedItems.length > 0) {
				// User explicitly selected items (using Space or checkboxes)
				itemsToProcess = selectedItems;
			} else if (quickPick.activeItems.length > 0) {
				// No explicit selection, use the active/highlighted item
				itemsToProcess = [quickPick.activeItems[0]];
			}
			
			if (itemsToProcess.length > 0) {				try {
					if (action === DirectoryAction.AddToWorkspace) {
						await WorkspaceManager.addDirectoriesToWorkspace(itemsToProcess);
					} else {
						await WorkspaceManager.openDirectoriesInWindow(itemsToProcess);
					}
				} catch (error) {
					const actionText = action === DirectoryAction.AddToWorkspace ? 'adding' : 'opening';
					vscode.window.showErrorMessage(`Error ${actionText} directories: ${error}`);
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
