import * as vscode from "vscode";
import * as path from "path";
import { DirectoryItem, DirectoryAction } from "./types";
import { WorkspaceManager } from "./workspace";
import { ConfigurationManager } from "./configuration";
import { DirectorySearcher } from "./directory-search";
import { DirectoryFilter } from "./filter";

export class DirectoryPicker {
	static async showDirectoryPicker(
		directories: DirectoryItem[],
		action: DirectoryAction = DirectoryAction.AddToWorkspace,
		forceNewWindow: boolean = false
	): Promise<void> {
		// Check if fzf is available for enhanced filtering
		const isFzfEnabled = ConfigurationManager.isFzfEnabled();
		const fzfPath = ConfigurationManager.getFzfPath();
		let useFzfFiltering = false;
		if (isFzfEnabled) {
			try {
				await DirectorySearcher.checkFzfAvailability(fzfPath);
				useFzfFiltering = true;
			} catch (error) {
				// fzf not available, fall back to VS Code built-in matching
			}
		}
		const quickPick = vscode.window.createQuickPick<DirectoryItem>();

		// Performance optimization: limit initial items for large datasets
		const INITIAL_DISPLAY_LIMIT = ConfigurationManager.getUiDisplayLimit();
		const shouldLimitInitialDisplay =
			INITIAL_DISPLAY_LIMIT > 0 && directories.length > INITIAL_DISPLAY_LIMIT; // Configure QuickPick based on filtering method
		let displayDirectories = directories;
		if (useFzfFiltering) {
			// When using fzf, disable VS Code's filtering and sorting to maintain fzf's superior ranking
			quickPick.matchOnDescription = false;
			quickPick.matchOnDetail = false;

			// Transform directories to preserve fzf ordering
			displayDirectories = directories.map((dir, index) => ({
				...dir,
				// Add subtle visual indicator for match quality (will be computed during filtering)
				sortText: `${String(index).padStart(6, "0")}_${dir.label}`, // Preserve order
			}));
		} else {
			// Use VS Code's built-in filtering with highlighting
			quickPick.matchOnDescription = true;
			quickPick.matchOnDetail = true;
		}

		const initialItems =
			shouldLimitInitialDisplay && !useFzfFiltering
				? displayDirectories.slice(0, INITIAL_DISPLAY_LIMIT)
				: displayDirectories;

		quickPick.items = initialItems;
		quickPick.canSelectMany = action === DirectoryAction.AddToWorkspace;

		const updatePlaceholder = () => {
			const searchTerm = quickPick.value.trim();

			if (searchTerm === "") {
				quickPick.placeholder = `Search ${directories.length} directories`;
			} else {
				const resultCount = quickPick.items.length;
				quickPick.placeholder = `${resultCount} matches found`;
			}
		}; // Handle value changes with smart filtering
		let filterTimeout: NodeJS.Timeout | undefined;
		let isFilteringInProgress = false; // Track fzf filtering state

		quickPick.onDidChangeValue(async (value) => {
			// Clear any pending filter operation
			if (filterTimeout) {
				clearTimeout(filterTimeout);
			}
			if (useFzfFiltering) {
				// Use fzf for superior fuzzy matching, disable VS Code's filtering
				// Debounce fzf calls to avoid overwhelming the system
				filterTimeout = setTimeout(async () => {
					if (isFilteringInProgress) {
						return;
					}
					isFilteringInProgress = true;

					try {
						if (value.trim() !== "") {
							const filtered = await DirectoryFilter.filterWithFzf(
								directories,
								value,
								fzfPath
							);

							// Add subtle indicators for match quality without disrupting the core functionality
							const enhancedResults = filtered.map((dir, index) => {
								// Calculate a simple match quality score based on fzf ranking
								const matchQuality = Math.max(0, 1 - index / filtered.length);
								const qualityIndicator =
									matchQuality > 0.9
										? "★ "
										: matchQuality > 0.7
										? "• "
										: matchQuality > 0.3
										? "· "
										: "";

								return {
									...dir,
									label: `${qualityIndicator}${dir.label}`,
									alwaysShow: true, // Bypass VS Code's filtering
									sortText: `${String(index).padStart(6, "0")}_${dir.label}`, // Maintain fzf order
								};
							});
							quickPick.items = enhancedResults;
						} else {
							// Show all items when query is empty
							quickPick.items = displayDirectories;
						}
						updatePlaceholder();
					} finally {
						isFilteringInProgress = false;
					}
				}, 150); // 150ms debounce
			} else {
				// Use VS Code's built-in filtering (traditional behavior)
				if (value.trim() !== "" && shouldLimitInitialDisplay) {
					// When user starts typing, search the full dataset
					const filtered = directories.filter(
						(item) =>
							item.label.toLowerCase().includes(value.toLowerCase()) ||
							item.description?.toLowerCase().includes(value.toLowerCase())
					);
					quickPick.items = filtered;
				} else if (value.trim() === "" && shouldLimitInitialDisplay) {
					// Reset to limited initial display when search is cleared
					quickPick.items = initialItems;
				} else if (value.trim() === "" && !shouldLimitInitialDisplay) {
					// Show all items when search is cleared and no limit
					quickPick.items = directories;
				}
				updatePlaceholder();
			}
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
						// For OpenInWindow action, use the forceNewWindow parameter
						await WorkspaceManager.openDirectoriesInNewWindow(
							itemsToProcess,
							forceNewWindow
						);
					}
				} catch (error) {
					const actionText =
						action === DirectoryAction.AddToWorkspace ? "adding" : "opening";
					vscode.window.showErrorMessage(
						`Error ${actionText} directories: ${error}`
					);
				}
			} else {
				vscode.window.showInformationMessage("No directory selected.", {
					modal: false,
				});
				setTimeout(() => {
					vscode.commands.executeCommand("workbench.action.closeMessages");
				}, 2000);
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

		// Log when the QuickPick actually becomes visible
		quickPick.onDidChangeSelection(() => {
			// UI is responsive
		});
	}
}
