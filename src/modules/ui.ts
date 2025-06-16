import * as vscode from 'vscode';
import { DirectoryItem, DirectoryAction } from './types';
import { WorkspaceManager } from './workspace';
import { ConfigurationManager } from './configuration';

export class DirectoryPicker {
	static async showDirectoryPicker(directories: DirectoryItem[], action: DirectoryAction = DirectoryAction.AddToWorkspace): Promise<void> {
		const methodStartTime = Date.now();
		console.log(`fd-palette: DirectoryPicker.showDirectoryPicker called with ${directories.length} directories`);
		
		const uiStartTime = Date.now();
		const quickPick = vscode.window.createQuickPick<DirectoryItem>();
		console.log(`fd-palette: createQuickPick took ${Date.now() - uiStartTime}ms`);
		
		// Performance optimization: limit initial items for large datasets
		const INITIAL_DISPLAY_LIMIT = ConfigurationManager.getUiDisplayLimit();
		const shouldLimitInitialDisplay = INITIAL_DISPLAY_LIMIT > 0 && directories.length > INITIAL_DISPLAY_LIMIT;
		const initialItems = shouldLimitInitialDisplay ? directories.slice(0, INITIAL_DISPLAY_LIMIT) : directories;
		
		quickPick.items = initialItems;
		quickPick.canSelectMany = action === DirectoryAction.AddToWorkspace; // Allow multiple selection for workspace
		quickPick.matchOnDescription = true;
		console.log(`fd-palette: UI setup with ${initialItems.length}/${directories.length} items took ${Date.now() - uiStartTime}ms (method total: ${Date.now() - methodStartTime}ms)`);
		// Set up dynamic placeholder based on action
		const updatePlaceholder = () => {
			const searchTerm = quickPick.value.trim();
			const actionText = action === DirectoryAction.AddToWorkspace ? 'add to workspace' : 'open in new window';
			
			if (searchTerm === '') {
				const displayText = `Search ${directories.length} directories (type to filter, Enter to ${actionText})`;
				quickPick.placeholder = displayText;
			} else {
				const multipleText = action === DirectoryAction.AddToWorkspace ? ', Space for multiple' : '';
				quickPick.placeholder = `Filtered results (Enter to ${actionText}${multipleText})`;
			}
		};
		// Handle value changes with smart filtering
		quickPick.onDidChangeValue((value) => {
			if (value.trim() !== '' && shouldLimitInitialDisplay) {
				// When user starts typing, search the full dataset
				const filterStartTime = Date.now();
				const filtered = directories.filter(item => 
					item.label.toLowerCase().includes(value.toLowerCase()) ||
					item.description?.toLowerCase().includes(value.toLowerCase())
				);
				quickPick.items = filtered;
				console.log(`fd-palette: Filtered ${directories.length} to ${filtered.length} items in ${Date.now() - filterStartTime}ms`);
			} else if (value.trim() === '' && shouldLimitInitialDisplay) {
				// Reset to limited initial display when search is cleared
				quickPick.items = initialItems;
			}
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
			
			if (itemsToProcess.length > 0) {
				try {
					if (action === DirectoryAction.AddToWorkspace) {
						await WorkspaceManager.addDirectoriesToWorkspace(itemsToProcess);
					} else {
						await WorkspaceManager.openDirectoriesInNewWindow(itemsToProcess);
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
		
		const showStartTime = Date.now();
		console.log('fd-palette: About to show QuickPick...');
		quickPick.show();
		console.log(`fd-palette: QuickPick.show() completed in ${Date.now() - showStartTime}ms`);
		
		// Log when the QuickPick actually becomes visible
		quickPick.onDidChangeSelection(() => {
			console.log('fd-palette: QuickPick selection changed (UI is responsive)');
		});
	}
}
