import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { DirectoryItem, DirectoryAction, SearchParams } from './types';
import { WorkspaceManager } from './workspace';
import { ConfigurationManager } from './configuration';
import { DirectorySearcher } from './directory-search';

export class DirectoryPicker {	private static async filterWithFzf(directories: DirectoryItem[], query: string, fzfPath: string): Promise<DirectoryItem[]> {
		if (!query.trim()) {
			return directories;
		}		return new Promise((resolve) => {
			// Prepare input for fzf: create enhanced searchable text optimized for fuzzy matching
			const directoryMap = new Map<string, DirectoryItem>();			const input = directories.map((dir, index) => {
				const key = `${index}`;
				directoryMap.set(key, dir);
				
				// Create searchable text optimized for fzf's path scheme
				// The path scheme gives bonus points to matches after path separators
				const dirName = path.basename(dir.fullPath);
				const fullPath = dir.fullPath;
				
				// Create multiple searchable variants for better matching
				// Use forward slashes as separators for consistent path handling across platforms
				const normalizedPath = fullPath.replace(/\\/g, '/');
				const normalizedDirName = dirName.replace(/[-_]/g, ' ');
				
				// Build searchable text: prioritize the actual path structure
				// fzf's path scheme will automatically give bonus to directory name matches
				const searchText = [
					normalizedPath,           // Full path with normalized separators  
					normalizedDirName,        // Normalized directory name for space-separated queries
					dirName                   // Original directory name for exact matches
				].join(' ');
				
				return `${key} ${searchText}`;
			}).join('\n');			// fzf arguments for enhanced fuzzy matching optimized for directory names
			const fzfArgs = [
				'--filter', query,        // Non-interactive filtering mode
				'--scheme=path',          // Use path-optimized scoring - gives bonus to matches after path separators
				'--algo=v2',              // Use optimal scoring algorithm
				'--smart-case',           // Smart case: case-insensitive unless query has uppercase
				'--delimiter', ' ',       // Use space as delimiter
				'--with-nth', '2..',      // Only search in text after the key
				'--tiebreak=pathname,length' // Use path-aware tiebreaking (set automatically by --scheme=path)
			];const fzfChild = spawn(fzfPath, fzfArgs, {
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let output = '';
			let hasError = false;

			// Debug logging for fzf input/output
			if (query.includes('blend') || query.includes('vault') || query.includes('obsidian')) {
				console.log(`fd-palette: fzf debug - query: "${query}"`);
				console.log(`fd-palette: fzf debug - sample input lines:`, input.split('\n').slice(0, 5));
			}

			fzfChild.stdout?.on('data', (data) => {
				output += data.toString();
			});

			fzfChild.stderr?.on('data', (data) => {
				console.warn(`fd-palette: fzf filter error: ${data.toString()}`);
				hasError = true;
			});

			fzfChild.on('close', (code) => {				if (hasError || (code !== null && code !== 0)) {
					// Fall back to enhanced fuzzy-like filtering if fzf fails
					console.log('fd-palette: fzf filter failed, falling back to enhanced fuzzy matching');
					const queryLower = query.toLowerCase();
					const queryParts = queryLower.split(/\s+/).filter(part => part.length > 0);
					
					const fallbackFiltered = directories.filter(item => {
						const dirName = path.basename(item.fullPath).toLowerCase();
						const normalizedDirName = dirName.replace(/[-_]/g, ' ');
						const normalizedDirNameNoSep = dirName.replace(/[-_]/g, '');
						const fullPathNormalized = item.fullPath.toLowerCase().replace(/[-_]/g, ' ');
						
						const searchTexts = [
							normalizedDirName,        // Primary: normalized directory name with spaces
							normalizedDirNameNoSep,   // Directory name without separators
							dirName,                  // Original directory name
							fullPathNormalized,       // Normalized full path
							item.fullPath.toLowerCase() // Original full path
						];
						
						// Enhanced fuzzy-like matching: check if all query parts can be found
						// in any of the search texts (fuzzy matching simulation)
						return queryParts.every(part =>							searchTexts.some(text => {
								// Simple fuzzy matching: characters can be separated but must be in order
								let textIndex = 0;
								for (const char of part) {
									textIndex = text.indexOf(char, textIndex);
									if (textIndex === -1) {
										return false;
									}
									textIndex++;
								}
								return true;
							})
						);
					});
					
					// Sort fallback results by relevance (exact name matches first)
					fallbackFiltered.sort((a, b) => {
						const aName = path.basename(a.fullPath).toLowerCase();
						const bName = path.basename(b.fullPath).toLowerCase();
						const aNormalized = aName.replace(/[-_]/g, ' ');
						const bNormalized = bName.replace(/[-_]/g, ' ');
								// Prioritize exact matches to normalized names
						const queryNormalized = queryLower.replace(/\s+/g, ' ');
						if (aNormalized.includes(queryNormalized) && !bNormalized.includes(queryNormalized)) {
							return -1;
						}
						if (!aNormalized.includes(queryNormalized) && bNormalized.includes(queryNormalized)) {
							return 1;
						}
						
						// Then by directory name length (shorter = more specific)
						return aName.length - bName.length;					});
					
					resolve(fallbackFiltered);
					return;
				}// Parse fzf output and map back to DirectoryItem objects
				const matchedLines = output.trim().split('\n').filter(line => line.trim() !== '');
				const matchedDirectories: DirectoryItem[] = [];
				
				// Debug logging for fzf results
				if (query.includes('blend') || query.includes('vault') || query.includes('obsidian')) {
					console.log(`fd-palette: fzf debug - output lines:`, matchedLines.slice(0, 10));
				}
				
				matchedLines.forEach(line => {
					const firstSpace = line.indexOf(' ');
					if (firstSpace > 0) {
						const key = line.substring(0, firstSpace);
						const dir = directoryMap.get(key);
						if (dir) {
							matchedDirectories.push(dir);
							// Log matching directories for debugging
							if (query.includes('blend') || query.includes('vault') || query.includes('obsidian')) {
								console.log(`fd-palette: fzf debug - matched: ${path.basename(dir.fullPath)} (${dir.fullPath})`);
							}
						}
					}				});				// Post-process results to improve hierarchical ranking
				// Boost children of well-matched directories
				const enhancedResults = DirectoryPicker.enhanceHierarchicalRanking(matchedDirectories, query);
				
				console.log(`fd-palette: fzf filtered ${directories.length} to ${enhancedResults.length} directories for query "${query}"`);
				resolve(enhancedResults);
			});

			fzfChild.on('error', (error) => {
				console.warn(`fd-palette: fzf spawn error: ${error.message}`);
				// Fall back to enhanced simple filtering
				const queryLower = query.toLowerCase();
				const queryParts = queryLower.split(/\s+/).filter(part => part.length > 0);
						const fallbackFiltered = directories.filter(item => {
					const searchText = [
						item.label,
						item.description || '',
						item.fullPath
					].join(' ').toLowerCase();
							// Enhanced matching: all query parts must be found
					return queryParts.every(part => searchText.includes(part));				});
				
				resolve(fallbackFiltered);
			});

			// Send input to fzf
			fzfChild.stdin?.write(input);
			fzfChild.stdin?.end();
		});
	}
	
	static async showDirectoryPicker(directories: DirectoryItem[], action: DirectoryAction = DirectoryAction.AddToWorkspace): Promise<void> {
		const methodStartTime = Date.now();
		console.log(`fd-palette: DirectoryPicker.showDirectoryPicker called with ${directories.length} directories`);
		
		// Check if fzf is available for enhanced filtering
		const isFzfEnabled = ConfigurationManager.isFzfEnabled();
		const fzfPath = ConfigurationManager.getFzfPath();
		let useFzfFiltering = false;
		
		if (isFzfEnabled) {
			try {
				await DirectorySearcher.checkFzfAvailability(fzfPath);
				useFzfFiltering = true;
				console.log('fd-palette: Using fzf for enhanced fuzzy matching');
			} catch (error) {
				console.log('fd-palette: fzf not available, using VS Code built-in matching');
			}
		}
		
		const uiStartTime = Date.now();
		const quickPick = vscode.window.createQuickPick<DirectoryItem>();
		console.log(`fd-palette: createQuickPick took ${Date.now() - uiStartTime}ms`);
		
		// Performance optimization: limit initial items for large datasets
		const INITIAL_DISPLAY_LIMIT = ConfigurationManager.getUiDisplayLimit();
		const shouldLimitInitialDisplay = INITIAL_DISPLAY_LIMIT > 0 && directories.length > INITIAL_DISPLAY_LIMIT;		// Configure QuickPick based on filtering method
		let displayDirectories = directories;
		if (useFzfFiltering) {
			// When using fzf, disable VS Code's filtering and sorting to maintain fzf's superior ranking
			quickPick.matchOnDescription = false;
			quickPick.matchOnDetail = false;
			
			// Transform directories to preserve fzf ordering
			displayDirectories = directories.map((dir, index) => ({
				...dir,
				// Add subtle visual indicator for match quality (will be computed during filtering)
				sortText: `${String(index).padStart(6, '0')}_${dir.label}` // Preserve order
			}));
		} else {
			// Use VS Code's built-in filtering with highlighting
			quickPick.matchOnDescription = true;
			quickPick.matchOnDetail = true;
		}
		
		const initialItems = shouldLimitInitialDisplay && !useFzfFiltering 
			? displayDirectories.slice(0, INITIAL_DISPLAY_LIMIT) 
			: displayDirectories;
		
		quickPick.items = initialItems;
		quickPick.canSelectMany = action === DirectoryAction.AddToWorkspace;
		console.log(`fd-palette: UI setup with ${initialItems.length}/${directories.length} items took ${Date.now() - uiStartTime}ms (method total: ${Date.now() - methodStartTime}ms)`);		const updatePlaceholder = () => {
			const searchTerm = quickPick.value.trim();
			const actionText = action === DirectoryAction.AddToWorkspace ? 'add to workspace' : 'open in new window';
			const fuzzyText = useFzfFiltering ? ' (fzf fuzzy matching: "blend vault" → "blend-vault")' : '';
			
			if (searchTerm === '') {
				quickPick.placeholder = `Search ${directories.length} directories${fuzzyText} (type to filter, Enter to ${actionText})`;
			} else {
				const multipleText = action === DirectoryAction.AddToWorkspace ? ', Space for multiple' : '';
				const resultCount = quickPick.items.length;
				quickPick.placeholder = `${resultCount} matches found${fuzzyText} (Enter to ${actionText}${multipleText})`;
			}
		};// Handle value changes with smart filtering
		let filterTimeout: NodeJS.Timeout | undefined;
		let isFilteringInProgress = false; // Track fzf filtering state
		
		quickPick.onDidChangeValue(async (value) => {
			const filterStartTime = Date.now();
			
			// Clear any pending filter operation
			if (filterTimeout) {
				clearTimeout(filterTimeout);
			}			if (useFzfFiltering) {
				// Use fzf for superior fuzzy matching, disable VS Code's filtering
				filterTimeout = setTimeout(async () => {
					if (isFilteringInProgress) {
						return;
					}
					isFilteringInProgress = true;
					
					try {
						if (value.trim() !== '') {
							const filtered = await DirectoryPicker.filterWithFzf(directories, value, fzfPath);
							
							// Add subtle indicators for match quality without disrupting the core functionality
							const enhancedResults = filtered.map((dir, index) => {
								// Calculate a simple match quality score based on fzf ranking
								const matchQuality = Math.max(0, 1 - (index / filtered.length));
								const qualityIndicator = matchQuality > 0.9 ? '★ ' : 
								                       matchQuality > 0.7 ? '• ' : 
								                       matchQuality > 0.3 ? '· ' : '';
								
								return {
									...dir,
									label: `${qualityIndicator}${dir.label}`,
									alwaysShow: true, // Bypass VS Code's filtering
									sortText: `${String(index).padStart(6, '0')}_${dir.label}` // Maintain fzf order
								};
							});
							
							quickPick.items = enhancedResults;
							console.log(`fd-palette: fzf filtered ${directories.length} to ${enhancedResults.length} items in ${Date.now() - filterStartTime}ms`);
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
				if (value.trim() !== '' && shouldLimitInitialDisplay) {
					// When user starts typing, search the full dataset
					const filtered = directories.filter(item => 
						item.label.toLowerCase().includes(value.toLowerCase()) ||
						item.description?.toLowerCase().includes(value.toLowerCase())
					);
					quickPick.items = filtered;
					console.log(`fd-palette: Simple filtered ${directories.length} to ${filtered.length} items in ${Date.now() - filterStartTime}ms`);
				} else if (value.trim() === '' && shouldLimitInitialDisplay) {
					// Reset to limited initial display when search is cleared
					quickPick.items = initialItems;
				} else if (value.trim() === '' && !shouldLimitInitialDisplay) {
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

	/**
	 * Enhance hierarchical ranking by boosting children of well-matched directories
	 */
	private static enhanceHierarchicalRanking(directories: DirectoryItem[], query: string): DirectoryItem[] {
		if (directories.length === 0) {
			return directories;
		}

		// Find directories that are likely good matches for the query
		const queryLower = query.toLowerCase();
		const queryParts = queryLower.split(/\s+/).filter(part => part.length > 0);
		
		// Score each directory based on how well it matches the query
		const scoredDirectories = directories.map((dir, originalIndex) => {
			const dirName = path.basename(dir.fullPath).toLowerCase();
			const normalizedDirName = dirName.replace(/[-_]/g, ' ');
			
			let score = 0;
			
			// High score for directories that match the query well
			const allQueryPartsFound = queryParts.every(part => 
				normalizedDirName.includes(part) || dirName.includes(part)
			);
			
			if (allQueryPartsFound) {
				// Exact or near-exact match
				if (normalizedDirName === queryLower || dirName === queryLower) {
					score = 1000; // Highest score for exact matches
				} else if (normalizedDirName.includes(queryLower.replace(/\s+/g, ' '))) {
					score = 900; // High score for normalized matches
				} else {
					score = 800; // Good score for partial matches
				}
			}
			
			return {
				directory: dir,
				score,
				originalIndex,
				isParentMatch: score >= 800
			};
		});
		// Find well-matched parent directories
		const parentMatches = scoredDirectories
			.filter(item => item.isParentMatch)
			.map(item => item.directory.fullPath);

		// Debug logging for hierarchical ranking
		if (query.includes('blend') || query.includes('vault') || query.includes('obsidian')) {
			console.log(`fd-palette: hierarchical debug - parent matches:`, parentMatches.map(p => path.basename(p)));
		}

		// Boost children of well-matched parents
		const enhancedScores = scoredDirectories.map(item => {
			let boostedScore = item.score;
			
			// Check if this directory is a child of any well-matched parent
			const isChildOfMatch = parentMatches.some(parentPath => {
				return item.directory.fullPath.startsWith(parentPath + path.sep) &&
					   item.directory.fullPath !== parentPath;
			});
					if (isChildOfMatch && boostedScore < 700) {
				// Boost children of matched parents, but keep them below the parent
				boostedScore = 750;
				
				// Debug logging for boosted children
				if (query.includes('blend') || query.includes('vault') || query.includes('obsidian')) {
					console.log(`fd-palette: hierarchical debug - boosted child: ${path.basename(item.directory.fullPath)} (score: ${boostedScore})`);
				}
			}
			
			return {
				...item,
				score: boostedScore
			};
		});

		// Sort by score (descending), then by original fzf order for tied scores
		enhancedScores.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			return a.originalIndex - b.originalIndex;
		});

		return enhancedScores.map(item => item.directory);
	}
}