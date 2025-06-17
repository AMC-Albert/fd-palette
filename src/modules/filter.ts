import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import { DirectoryItem, ItemType } from "./types";
import { ConfigurationManager } from "./configuration";
import { CacheManager } from "./cache";

export class DirectoryFilter {
	/**
	 * Filter directories using fzf for enhanced fuzzy matching
	 */
	static async filterWithFzf(
		directories: DirectoryItem[],
		query: string,
		fzfPath: string,
		cacheManager?: CacheManager
	): Promise<DirectoryItem[]> {
		// Early return for very short queries - fzf isn't effective with single characters
		if (query.trim().length < 2) {
			return directories;
		} // Limit dataset size for performance - fzf can be slow with very large datasets
		const maxDatasetSize = 3000; // Reduced for faster performance
		let datasetToFilter: DirectoryItem[];
		if (directories.length > maxDatasetSize) {
			// For general queries, use the existing permissive character-based matching
			const queryChars = query.toLowerCase().replace(/\s+/g, "").split("");

			const potentialMatches = directories.filter((dir) => {
				if (queryChars.length === 0) {
					return true;
				}

				// Very permissive character-based matching for general queries
				const searchTexts = [
					`${dir.label} ${dir.fullPath}`
						.toLowerCase()
						.replace(/[\s\-_\.]/g, ""), // No separators
					`${dir.label} ${dir.fullPath}`.toLowerCase().replace(/[\-_\.]/g, " "), // Spaces instead of separators
					`${dir.label} ${dir.fullPath}`.toLowerCase(), // Original
					path
						.basename(dir.fullPath)
						.toLowerCase()
						.replace(/[\s\-_\.]/g, ""), // Just dirname, no separators
				];

				// If any of the search texts can match all query characters in order, include this directory
				return searchTexts.some((searchText) => {
					let queryIndex = 0;
					for (
						let i = 0;
						i < searchText.length && queryIndex < queryChars.length;
						i++
					) {
						if (searchText[i] === queryChars[queryIndex]) {
							queryIndex++;
						}
					}
					return queryIndex === queryChars.length;
				});
			});

			datasetToFilter =
				potentialMatches.length <= maxDatasetSize
					? potentialMatches
					: potentialMatches
							.sort((a, b) => a.fullPath.length - b.fullPath.length)
							.slice(0, maxDatasetSize);
		}
		datasetToFilter = directories;
		return new Promise((resolve) => {
			// Prepare input for fzf: create enhanced searchable text optimized for fuzzy matching
			const directoryMap = new Map<string, DirectoryItem>();
			const input = datasetToFilter
				.map((dir, index) => {
					const key = `${index}`;
					directoryMap.set(key, dir); // Create focused searchable text optimized for fzf's fuzzy matching
					const dirName = path.basename(dir.fullPath);
					const fullPath = dir.fullPath;
					const normalizedPath = fullPath.replace(/\\/g, "/");

					// Provide key variations to handle different separator conventions
					// Include versions with hyphens, underscores, and no separators
					const dirNameWithUnderscore = dirName.replace(/[-\.]/g, "_");
					const dirNameNoSeparators = dirName.replace(/[-_\.]/g, "");
					const searchText = `${normalizedPath} ${dirName} ${dirNameWithUnderscore} ${dirNameNoSeparators}`;

					return `${key} ${searchText}`;
				})
				.join("\n"); // fzf arguments for enhanced fuzzy matching optimized for directory names
			// Use different strategies based on query characteristics
			const fzfArgs = [
				"--filter",
				query, // Non-interactive filtering mode
				"--algo=v2", // Use optimal scoring algorithm
				"+x", // Disable extended search to handle special characters (!, ^, $, etc.) as literals
				// --literal doesn't work properly with ! at start of query (treated as negation)
				"--delimiter",
				" ", // Use space as delimiter
				"--with-nth",
				"2..", // Only search in text after the key
				"--tiebreak=length,begin", // Prefer shorter matches and matches at the beginning
			];

			const fzfChild = spawn(fzfPath, fzfArgs, {
				stdio: ["pipe", "pipe", "pipe"],
			});
			let output = "";
			let hasError = false;

			fzfChild.stdout?.on("data", (data) => {
				output += data.toString();
			});

			fzfChild.stderr?.on("data", (data) => {
				console.warn(`rip-open: fzf filter error: ${data.toString()}`);
				hasError = true;
			});
			fzfChild.on("close", (code) => {
				if (hasError || (code !== null && code !== 0)) {
					// Fall back to enhanced fuzzy-like filtering if fzf fails
					const fallbackFiltered = DirectoryFilter.fallbackFilter(
						datasetToFilter,
						query
					);
					resolve(fallbackFiltered);
					return;
				}

				// Parse fzf output and map back to DirectoryItem objects
				const matchedLines = output
					.trim()
					.split("\n")
					.filter((line) => line.trim() !== "");
				const matchedDirectories: DirectoryItem[] = [];

				matchedLines.forEach((line) => {
					const firstSpace = line.indexOf(" ");
					if (firstSpace > 0) {
						const key = line.substring(0, firstSpace);
						const dir = directoryMap.get(key);
						if (dir) {
							matchedDirectories.push(dir);
						}
					}
				});

				// Post-process results to improve hierarchical ranking
				// Boost children of well-matched directories
				// Include subdirectories of exact match folders when query matches a folder exactly
				const queryLower = query.toLowerCase();
				const exactParents = directories.filter(
					(dir) => path.basename(dir.fullPath).toLowerCase() === queryLower
				);
				const matchedSet = new Set(matchedDirectories.map((d) => d.fullPath));
				const extraChildren: DirectoryItem[] = [];
				exactParents.forEach((parent) => {
					const parentPath = parent.fullPath;
					directories.forEach((dir) => {
						if (
							dir.fullPath.startsWith(parentPath + path.sep) &&
							!matchedSet.has(dir.fullPath)
						) {
							extraChildren.push(dir);
							matchedSet.add(dir.fullPath);
						}
					});
				});

				// Merge original matches with extra children before ranking
				const finalMatches = matchedDirectories.concat(extraChildren);

				const enhancedResults = DirectoryFilter.enhanceHierarchicalRanking(
					finalMatches,
					query,
					cacheManager
				);
				resolve(enhancedResults);
			});

			fzfChild.on("error", (error) => {
				console.warn(`rip-open: fzf spawn error: ${error.message}`);
				// Fall back to enhanced simple filtering
				const fallbackFiltered = DirectoryFilter.fallbackFilter(
					datasetToFilter,
					query
				);
				resolve(fallbackFiltered);
			});

			// Send input to fzf
			fzfChild.stdin?.write(input);
			fzfChild.stdin?.end();
		});
	}

	/**
	 * Fallback filtering when fzf is not available or fails
	 */
	static fallbackFilter(
		directories: DirectoryItem[],
		query: string
	): DirectoryItem[] {
		const queryLower = query.toLowerCase();
		const queryParts = queryLower
			.split(/\s+/)
			.filter((part) => part.length > 0);

		const fallbackFiltered = directories.filter((item) => {
			const dirName = path.basename(item.fullPath).toLowerCase();
			const normalizedDirName = dirName.replace(/[-_]/g, " ");
			const normalizedDirNameNoSep = dirName.replace(/[-_]/g, "");
			const fullPathNormalized = item.fullPath
				.toLowerCase()
				.replace(/[-_]/g, " ");

			const searchTexts = [
				normalizedDirName, // Primary: normalized directory name with spaces
				normalizedDirNameNoSep, // Directory name without separators
				dirName, // Original directory name
				fullPathNormalized, // Normalized full path
				item.fullPath.toLowerCase(), // Original full path
			];

			// Enhanced fuzzy-like matching: check if all query parts can be found
			// in any of the search texts (fuzzy matching simulation)
			return queryParts.every((part) =>
				searchTexts.some((text) => {
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
			const aNormalized = aName.replace(/[-_]/g, " ");
			const bNormalized = bName.replace(/[-_]/g, " ");
			// Prioritize exact matches to normalized names
			const queryNormalized = queryLower.replace(/\s+/g, " ");
			if (
				aNormalized.includes(queryNormalized) &&
				!bNormalized.includes(queryNormalized)
			) {
				return -1;
			}
			if (
				!aNormalized.includes(queryNormalized) &&
				bNormalized.includes(queryNormalized)
			) {
				return 1;
			}
			// Fallback to shorter name first
			return aName.length - bName.length;
		});

		// Include subdirectories of exact match folders when query matches a folder exactly
		const exactParents = directories.filter(
			(dir) => path.basename(dir.fullPath).toLowerCase() === queryLower
		);
		const matchedSetFallback = new Set(
			fallbackFiltered.map((item) => item.fullPath)
		);
		exactParents.forEach((parent) => {
			const parentPath = parent.fullPath;
			directories.forEach((dir) => {
				if (
					dir.fullPath.startsWith(parentPath + path.sep) &&
					!matchedSetFallback.has(dir.fullPath)
				) {
					fallbackFiltered.push(dir);
					matchedSetFallback.add(dir.fullPath);
				}
			});
		});

		return fallbackFiltered;
	}

	/**
	 * Simple fallback filter for when fzf spawn fails
	 */
	static simpleFallbackFilter(
		directories: DirectoryItem[],
		query: string
	): DirectoryItem[] {
		const queryLower = query.toLowerCase();
		const queryParts = queryLower
			.split(/\s+/)
			.filter((part) => part.length > 0);

		return directories.filter((item) => {
			const searchText = [item.label, item.description || "", item.fullPath]
				.join(" ")
				.toLowerCase();
			// Enhanced matching: all query parts must be found
			return queryParts.every((part) => searchText.includes(part));
		});
	}
	/**
	 * Enhance hierarchical ranking by boosting children of well-matched directories
	 */
	static enhanceHierarchicalRanking(
		directories: DirectoryItem[],
		query: string,
		cacheManager?: CacheManager
	): DirectoryItem[] {
		if (directories.length === 0) {
			return directories;
		}

		// Find directories that are likely good matches for the query
		const queryLower = query.toLowerCase();
		const queryParts = queryLower
			.split(/\s+/)
			.filter((part) => part.length > 0);
		// Score each directory based on how well it matches the query
		const searchParams = ConfigurationManager.getSearchParams();
		const shouldBoostGitDirs = searchParams.boostGitDirectories;

		const scoredDirectories = directories.map((dir, originalIndex) => {
			const dirName = path.basename(dir.fullPath).toLowerCase();
			const normalizedDirName = dirName.replace(/[-_]/g, " ");

			let score = 0;

			// Boost exact directory name matches
			if (dirName === queryLower) {
				score += 100;
			} else if (normalizedDirName === queryLower) {
				score += 90;
			} else if (dirName.includes(queryLower)) {
				score += 50;
			} else if (normalizedDirName.includes(queryLower)) {
				score += 40;
			}

			// Boost directories where all query parts match the directory name
			const allPartsInDirName = queryParts.every((part) =>
				normalizedDirName.includes(part)
			);
			if (allPartsInDirName) {
				score += 30;
			} // Boost git repositories (directories containing .git folder)
			if (shouldBoostGitDirs && cacheManager) {
				try {
					if (cacheManager.isGitRepository(dir.fullPath)) {
						score += 50; // Strong boost for git repositories - higher than most other boosts
						// Debug log removed for reduced verbosity
					}
				} catch (error) {
					// Ignore filesystem errors - just skip the boost
				}
			}

			if (dir.itemType === ItemType.WorkspaceFile) {
				score += 60; // Higher than git repos for workspace files
			}

			// Boost shorter paths (more specific)
			const pathDepth = dir.fullPath.split(path.sep).length;
			score += Math.max(0, 20 - pathDepth);

			return {
				directory: dir,
				score,
				originalIndex,
			};
		});

		// Find well-matched parent directories (score > 40)
		const wellMatchedParents = scoredDirectories
			.filter((item) => item.score > 40)
			.map((item) => item.directory.fullPath);

		// Enhance scores for directories that are children of well-matched parents
		const enhancedScores = scoredDirectories.map((item) => {
			let enhancedScore = item.score;

			// Check if this directory is a child of any well-matched parent
			for (const parentPath of wellMatchedParents) {
				if (
					item.directory.fullPath !== parentPath &&
					item.directory.fullPath.startsWith(parentPath + path.sep)
				) {
					enhancedScore += 15; // Boost child directories
					break;
				}
			}

			return {
				...item,
				score: enhancedScore,
			};
		}); // Sort by enhanced score (descending), then prefer git repos, then by original fzf order
		enhancedScores.sort((a, b) => {
			if (a.score !== b.score) {
				return b.score - a.score;
			}

			// Tie-breaker: prefer git repositories
			if (shouldBoostGitDirs && cacheManager) {
				const aIsGit = cacheManager.isGitRepository(a.directory.fullPath);
				const bIsGit = cacheManager.isGitRepository(b.directory.fullPath);
				if (aIsGit && !bIsGit) {
					return -1;
				}
				if (!aIsGit && bIsGit) {
					return 1;
				}
			}

			return a.originalIndex - b.originalIndex;
		});
		// Debug: show top scored directories (reduced verbosity)
		// console.log("rip-open: Top 5 scored directories:");
		// enhancedScores.slice(0, 5).forEach((item, index) => {
		// 	const isGit = cacheManager
		// 		? cacheManager.isGitRepository(item.directory.fullPath)
		// 		: false;
		// 	console.log(
		// 		`  ${index}: score=${item.score}, git=${isGit}, path=${item.directory.fullPath}`
		// 	);
		// });

		return enhancedScores.map((item) => item.directory);
	}
}
