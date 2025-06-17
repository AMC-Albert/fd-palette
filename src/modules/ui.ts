import * as vscode from "vscode";
import * as path from "path";
import { DirectoryItem, DirectoryAction, ItemType } from "./types";
import { WorkspaceManager } from "./workspace";
import { ConfigurationManager } from "./configuration";
import { DirectorySearcher } from "./directory-search";
import { DirectoryFilter } from "./filter";
import { CacheManager } from "./cache";

export class DirectoryPicker {
	static async showDirectoryPicker(
		directories: DirectoryItem[],
		action: DirectoryAction = DirectoryAction.AddToWorkspace,
		forceNewWindow: boolean = false,
		cacheManager?: CacheManager
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
			// Disable any automatic sorting behavior
			(quickPick as any).sortByLabel = false;

			// Transform directories to preserve fzf ordering
			displayDirectories = directories.map((dir, index) => ({
				...dir,
				// Use sortText to enforce ordering - pad with zeros for proper sorting
				sortText: `${String(index).padStart(6, "0")}`, // Preserve order
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
								fzfPath,
								cacheManager
							); // Add subtle indicators for match quality without disrupting sorting
							const enhancedResults = filtered.map((dir, index) => {
								// Calculate quality indicator based on final ranking position (after enhanced scoring)								// Items that appear first after enhanced ranking get better indicators
								const finalPosition = index;
								const totalResults = filtered.length;
								const positionQuality = Math.max(
									0,
									1 - finalPosition / totalResults
								); // Debug: log the first few items to verify ordering (reduced verbosity)
								// if (index < 3) {
								// 	console.log(
								// 		`rip-open: UI item ${index}: ${dir.label} at ${dir.fullPath}`
								// 	);
								// }								// Check if this is a git repository
								const isGitRepo = cacheManager
									? cacheManager.isGitRepository(dir.fullPath)
									: false;

								// Check if this is a workspace file
								const isWorkspaceFile = dir.itemType === ItemType.WorkspaceFile;

								const qualityIndicator =
									positionQuality > 0.9
										? "★"
										: positionQuality > 0.7
										? "•"
										: positionQuality > 0.3
										? "·"
										: "";

								// Choose appropriate icon - workspace files get repo icon, git repos get branch icon
								let typeIndicator = "";
								if (isWorkspaceFile) {
									typeIndicator = "$(repo) ";
								} else if (isGitRepo) {
									typeIndicator = "$(git-branch) ";
								}

								// Combine type indicator with the original label
								const enhancedLabel = `${typeIndicator}${dir.label}`;

								// Keep quality indicator in description
								const originalDescription = dir.description || dir.fullPath;
								const enhancedDescription = qualityIndicator
									? `${qualityIndicator} ${originalDescription}`
									: originalDescription;
								return {
									...dir,
									label: enhancedLabel,
									description: enhancedDescription,
									alwaysShow: true, // Bypass VS Code's filtering
									sortText: `${String(index).padStart(6, "0")}`, // Maintain fzf order with proper padding
									filterText: `${String(index).padStart(6, "0")}_${dir.label}`, // Ensure VS Code respects our order
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
				}, 50); // 50ms debounce - faster response
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
