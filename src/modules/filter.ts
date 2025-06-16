import * as path from "path";
import { spawn } from "child_process";
import { DirectoryItem } from "./types";

export class DirectoryFilter {
	/**
	 * Filter directories using fzf for enhanced fuzzy matching
	 */
	static async filterWithFzf(
		directories: DirectoryItem[],
		query: string,
		fzfPath: string
	): Promise<DirectoryItem[]> {
		// Early return for very short queries - fzf isn't effective with single characters
		if (query.trim().length < 2) {
			return directories;
		}

		// Limit dataset size for performance - fzf can be slow with very large datasets
		const maxDatasetSize = 3000;
		const datasetToFilter =
			directories.length > maxDatasetSize
				? directories.slice(0, maxDatasetSize)
				: directories;

		return new Promise((resolve) => {
			// Prepare input for fzf: create enhanced searchable text optimized for fuzzy matching
			const directoryMap = new Map<string, DirectoryItem>();
			const input = datasetToFilter
				.map((dir, index) => {
					const key = `${index}`;
					directoryMap.set(key, dir);

					// Create searchable text optimized for fzf's path scheme
					// The path scheme gives bonus points to matches after path separators
					const dirName = path.basename(dir.fullPath);
					const fullPath = dir.fullPath;

					// Create multiple searchable variants for better matching
					// Use forward slashes as separators for consistent path handling across platforms
					const normalizedPath = fullPath.replace(/\\/g, "/");
					const normalizedDirName = dirName.replace(/[-_]/g, " ");

					// Build searchable text: prioritize the actual path structure
					// fzf's path scheme will automatically give bonus to directory name matches
					const searchText = [
						normalizedPath, // Full path with normalized separators
						normalizedDirName, // Normalized directory name for space-separated queries
						dirName, // Original directory name for exact matches
					].join(" ");

					return `${key} ${searchText}`;
				})
				.join("\n");

			// fzf arguments for enhanced fuzzy matching optimized for directory names
			const fzfArgs = [
				"--filter",
				query, // Non-interactive filtering mode
				"--scheme=path", // Use path-optimized scoring - gives bonus to matches after path separators
				"--algo=v2", // Use optimal scoring algorithm
				"--smart-case", // Smart case: case-insensitive unless query has uppercase
				"--delimiter",
				" ", // Use space as delimiter
				"--with-nth",
				"2..", // Only search in text after the key
				"--tiebreak=pathname,length", // Use path-aware tiebreaking (set automatically by --scheme=path)
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
				console.warn(`rip-add: fzf filter error: ${data.toString()}`);
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
				const enhancedResults = DirectoryFilter.enhanceHierarchicalRanking(
					matchedDirectories,
					query
				);
				resolve(enhancedResults);
			});

			fzfChild.on("error", (error) => {
				console.warn(`rip-add: fzf spawn error: ${error.message}`);
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

			// Then by directory name length (shorter = more specific)
			return aName.length - bName.length;
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
		query: string
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
		});

		// Sort by enhanced score (descending), then by original fzf order
		enhancedScores.sort((a, b) => {
			if (a.score !== b.score) {
				return b.score - a.score;
			}
			return a.originalIndex - b.originalIndex;
		});

		return enhancedScores.map((item) => item.directory);
	}
}
