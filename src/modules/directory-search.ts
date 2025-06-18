import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { DirectoryItem, SearchParams, ItemType } from "./types";
import { ConfigurationManager } from "./configuration";
import {
	PathUtils,
	ProcessUtils,
	FileUtils,
	CommandAvailabilityUtils,
} from "./utils";

export class DirectorySearcher {
	private static _extensionContext: vscode.ExtensionContext | undefined;

	static setExtensionContext(context: vscode.ExtensionContext): void {
		this._extensionContext = context;
	}
	/**
	 * Check if ripgrep is available (either bundled or in PATH)
	 */
	static async checkRipgrepAvailability(): Promise<string> {
		const cacheKey = "ripgrep-availability";
		return CommandAvailabilityUtils.checkAvailability(
			this._extensionContext,
			cacheKey,
			await this._getAvailableRipgrepPath(),
			"ripgrep"
		) as Promise<string>;
	}

	/**
	 * Invalidate ripgrep availability cache (call when ripgrep execution fails)
	 */
	static async invalidateRipgrepCache(): Promise<void> {
		const cacheKey = "ripgrep-availability";
		await CommandAvailabilityUtils.invalidateCache(
			this._extensionContext,
			cacheKey
		);
	}
	/**
	 * Get the first available ripgrep path based on user configuration
	 */
	private static async _getAvailableRipgrepPath(): Promise<string> {
		const { ConfigurationManager } = await import("./configuration.js");
		const configuredPath = ConfigurationManager.getRipgrepPath();

		if (configuredPath !== "auto") {
			// User specified a custom ripgrep path
			try {
				await this._runRipgrepAvailabilityCheck(configuredPath);
				return configuredPath;
			} catch (error) {
				throw new Error(
					`Configured ripgrep path "${configuredPath}" is not available: ${error}`
				);
			}
		}
		// Auto mode: try bundled ripgrep first, then system ripgrep
		const bundledRg = PathUtils.getBundledRipgrepPath();
		if (bundledRg) {
			try {
				await this._runRipgrepAvailabilityCheck(bundledRg);
				return bundledRg;
			} catch (error) {
				console.warn(
					"rip-open: Bundled ripgrep failed availability check:",
					error
				);
			}
		}

		// Fallback to system ripgrep
		try {
			await this._runRipgrepAvailabilityCheck("rg");
			return "rg";
		} catch (error) {
			throw new Error("Neither bundled nor system ripgrep is available");
		}
	}
	/**
	 * Run ripgrep availability check
	 */
	private static async _runRipgrepAvailabilityCheck(
		rgPath: string
	): Promise<void> {
		return ProcessUtils.checkCommandAvailability(rgPath, "ripgrep");
	}
	/**
	 * Check if fzf is available (for enhanced fuzzy matching)
	 */
	static async checkFzfAvailability(fzfPath: string): Promise<void> {
		const cacheKey = `fzf-availability-${fzfPath}`;
		await CommandAvailabilityUtils.checkAvailability(
			this._extensionContext,
			cacheKey,
			fzfPath
		);
	}

	/**
	 * Invalidate fzf availability cache (call when fzf execution fails)
	 */
	static async invalidateFzfCache(fzfPath: string): Promise<void> {
		const cacheKey = `fzf-availability-${fzfPath}`;
		await CommandAvailabilityUtils.invalidateCache(
			this._extensionContext,
			cacheKey
		);
	}

	/**
	 * Clear fzf availability cache for a specific path
	 */
	static async clearFzfCache(fzfPath: string): Promise<void> {
		const cacheKey = `fzf-availability-${fzfPath}`;
		await CommandAvailabilityUtils.invalidateCache(
			this._extensionContext,
			cacheKey
		);
	}

	/**
	 * Run fzf availability check
	 */
	private static async _runFzfAvailabilityCheck(
		fzfPath: string
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const process = spawn(fzfPath, ["--version"], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let output = "";
			process.stdout?.on("data", (data) => {
				output += data.toString();
			});
			process.on("close", (code) => {
				if (code === 0) {
					// fzf version output doesn't always contain "fzf" string, just check exit code
					resolve();
				} else {
					reject(new Error(`fzf check failed with code ${code}`));
				}
			});
			process.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Run ripgrep across multiple search paths and merge results
	 */
	private static async _runRipgrepMultiplePaths(
		rgPath: string,
		baseArgs: string[],
		searchPaths: string[],
		token: vscode.CancellationToken
	): Promise<string> {
		return new Promise((resolve, reject) => {
			let allOutput = "";
			let pendingCommands = 0;
			let hasError = false;

			const handleCompletion = () => {
				if (pendingCommands === 0 && !hasError) {
					resolve(allOutput);
				}
			};
			// If no search paths, search from home directory instead of VSCode installation directory
			if (!searchPaths || searchPaths.length === 0) {
				searchPaths = [os.homedir()];
			}
			// Run ripgrep for each search path
			for (const searchPath of searchPaths) {
				pendingCommands++;

				const args = [...baseArgs];
				if (searchPath && searchPath.trim()) {
					args.push(searchPath);
				}

				console.log(
					`rip-open: Running ripgrep command: ${rgPath} ${args.join(" ")}`
				);

				const child = spawn(rgPath, args, {
					stdio: ["ignore", "pipe", "pipe"],
				});

				let stdout = "";
				let stderr = "";

				child.stdout?.on("data", (data) => {
					stdout += data.toString();
				});

				child.stderr?.on("data", (data) => {
					stderr += data.toString();
				});

				// Handle cancellation
				token.onCancellationRequested(() => {
					child.kill();
					if (!hasError) {
						hasError = true;
						reject(new Error("Search was cancelled"));
					}
				});
				child.on("close", (code) => {
					pendingCommands--;

					if (hasError) {
						return;
					}

					if (token.isCancellationRequested) {
						hasError = true;
						reject(new Error("Search was cancelled"));
						return;
					}
					if (code !== 0 && code !== 1) {
						// ripgrep exits with 1 when no matches found, which is normal
						console.error(
							`rip-open: ripgrep stderr for path "${searchPath}": ${stderr}`
						);
						hasError = true;
						// Invalidate cache since ripgrep execution failed
						this.invalidateRipgrepCache();
						reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
						return;
					}

					// Log results per path
					const resultCount = stdout
						.split("\0")
						.filter((line) => line.trim()).length;
					console.log(
						`rip-open: Path "${
							searchPath || "(root)"
						}" returned ${resultCount} file results`
					);

					// Append output from this path
					allOutput += stdout;
					handleCompletion();
				});
				child.on("error", (error) => {
					pendingCommands--;
					if (!hasError) {
						hasError = true;
						// Invalidate cache since ripgrep execution failed
						this.invalidateRipgrepCache();
						reject(new Error(`Failed to run ripgrep: ${error.message}`));
					}
				});
			}
		});
	}

	/**
	 * Find directories using ripgrep
	 */
	static async findDirectories(
		searchParams: SearchParams,
		token: vscode.CancellationToken
	): Promise<DirectoryItem[]> {
		try {
			// Get available ripgrep path
			const rgPath = await this.checkRipgrepAvailability();

			// Get all valid search paths
			const searchPaths = await ConfigurationManager.getValidSearchPaths();
			const baseArgs: string[] = [
				"--files", // List files (we'll filter directories from the output)
				"--null", // Use null separator for better parsing
			];

			// Add additional user-specified ripgrep arguments (includes --max-depth, --hidden, etc.)
			baseArgs.push(...searchParams.additionalRipgrepArgs);

			// Add exclude patterns using ripgrep's glob syntax
			for (const pattern of searchParams.excludePatterns) {
				baseArgs.push("--glob", `!${pattern}`);
			}

			console.log(
				`rip-open: Search paths: ${
					searchPaths.length > 0
						? searchPaths.join(", ")
						: "none (home directory search)"
				}`
			);
			console.log(
				`rip-open: Exclude patterns: ${searchParams.excludePatterns.join(", ")}`
			);
			console.log(
				`rip-open: Additional ripgrep args: ${searchParams.additionalRipgrepArgs.join(
					" "
				)}`
			);
			console.log(`rip-open: Ripgrep base args: ${baseArgs.join(" ")}`);

			// Run ripgrep across all search paths
			const stdout = await this._runRipgrepMultiplePaths(
				rgPath,
				baseArgs,
				searchPaths,
				token
			); // Parse ripgrep output to extract directories, workspace files, and fzf executables
			const { items: results, foundFzfPaths } = this._parseRipgrepOutput(
				stdout,
				searchParams.includeWorkspaceFiles,
				searchPaths
			);

			// Update fzf path if we found better options and update current search params
			const updatedFzfPath = await this._updateFzfPathIfBetter(
				foundFzfPaths,
				searchParams.fzfPath
			);
			if (updatedFzfPath !== searchParams.fzfPath) {
				searchParams.fzfPath = updatedFzfPath;
				console.log(
					`rip-open: Using newly found fzf path for current search: ${updatedFzfPath}`
				);
			}

			console.log(
				`rip-open: Found ${results.length} directories using ripgrep across ${
					searchPaths.length || "home directory"
				} search paths`
			);

			if (foundFzfPaths.length > 0) {
				console.log(
					`rip-open: Found ${
						foundFzfPaths.length
					} fzf executable(s): ${foundFzfPaths.join(", ")}`
				);
			}

			return results;
		} catch (error) {
			throw error;
		}
	}

	/**
	 * Parse ripgrep output to extract unique directories, workspace files, and fzf executables
	 */
	private static _parseRipgrepOutput(
		output: string,
		includeWorkspaceFiles: boolean = false,
		searchPaths: string[] = []
	): { items: DirectoryItem[]; foundFzfPaths: string[] } {
		const directories = new Set<string>();
		const workspaceFiles = new Set<string>();
		const fzfPaths = new Set<string>();
		const lines = output.split("\0").filter((line) => line.trim());

		// Extract directory paths, workspace files, and fzf executables
		for (const filePath of lines) {
			if (filePath.trim()) {
				if (includeWorkspaceFiles && filePath.endsWith(".code-workspace")) {
					workspaceFiles.add(filePath);
				}

				// Check if this could be an fzf executable
				const fileName = path.basename(filePath).toLowerCase();
				const isExecutable =
					process.platform === "win32"
						? fileName === "fzf.exe" || fileName === "fzf"
						: fileName === "fzf";

				if (isExecutable) {
					// Verify it's actually executable (basic check)
					try {
						const stats = fs.statSync(filePath);
						if (
							stats.isFile() &&
							(process.platform === "win32" || stats.mode & parseInt("111", 8))
						) {
							fzfPaths.add(filePath);
							console.log(
								`rip-open: Found potential fzf executable: ${filePath}`
							);
						}
					} catch {
						// Ignore stat errors
					}
				} // Extract all directory path segments from the file path
				this._extractAllDirectoryPaths(filePath, directories, searchPaths);
			}
		}

		// Add root-level directories to capture directories without files
		for (const root of searchPaths) {
			try {
				const entries = fs.readdirSync(root, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory()) {
						directories.add(path.join(root, entry.name));
					}
				}
			} catch {
				// ignore errors
			}
		}

		// Convert directories to DirectoryItem array
		const directoryItems: DirectoryItem[] = Array.from(directories)
			.filter((dir) => {
				const dirName = path.basename(dir);
				const isDotFolder = dirName.startsWith(".");
				return !isDotFolder; // Always exclude dot folders
			})
			.map((fullPath) => ({
				label: path.basename(fullPath),
				description: fullPath,
				fullPath: fullPath,
				itemType: ItemType.Directory,
			}));

		// Convert workspace files to DirectoryItem array
		const workspaceItems: DirectoryItem[] = Array.from(workspaceFiles).map(
			(fullPath) => ({
				label: path.basename(fullPath, ".code-workspace"),
				description: fullPath,
				fullPath: fullPath,
				itemType: ItemType.WorkspaceFile,
			})
		);
		// Combine, sort, and return
		const allItems = [...directoryItems, ...workspaceItems].sort((a, b) =>
			a.label.localeCompare(b.label)
		);

		return {
			items: allItems,
			foundFzfPaths: Array.from(fzfPaths),
		};
	}

	/**
	 * Find directories using ripgrep + fzf for enhanced fuzzy matching
	 */
	static async findDirectoriesWithFzf(
		searchParams: SearchParams,
		token: vscode.CancellationToken
	): Promise<DirectoryItem[]> {
		return new Promise(async (resolve, reject) => {
			try {
				// Get available ripgrep path
				const rgPath = await this.checkRipgrepAvailability(); // Get all valid search paths
				const searchPaths = await ConfigurationManager.getValidSearchPaths();

				// First, run ripgrep to get all files
				const baseArgs: string[] = [
					"--files", // List files
					"--null", // Use null separator
				];

				// Add additional user-specified ripgrep arguments
				baseArgs.push(...searchParams.additionalRipgrepArgs);

				// Add exclude patterns
				for (const pattern of searchParams.excludePatterns) {
					baseArgs.push("--glob", `!${pattern}`);
				}
				console.log(
					`rip-open: Running ripgrep for fzf across ${
						searchPaths.length || "root"
					} search paths`
				);
				console.log(
					`rip-open: Additional ripgrep args: ${searchParams.additionalRipgrepArgs.join(
						" "
					)}`
				); // Run ripgrep across all search paths
				const rgOutput = await this._runRipgrepMultiplePaths(
					rgPath,
					baseArgs,
					searchPaths,
					token
				);

				// Parse ripgrep output to extract directories, workspace files, and fzf executables
				const { items: parsedItems, foundFzfPaths } = this._parseRipgrepOutput(
					rgOutput,
					searchParams.includeWorkspaceFiles,
					searchPaths
				); // Update fzf path if we found better options and update current search params
				const updatedFzfPath = await this._updateFzfPathIfBetter(
					foundFzfPaths,
					searchParams.fzfPath
				);
				if (updatedFzfPath !== searchParams.fzfPath) {
					searchParams.fzfPath = updatedFzfPath;
					console.log(
						`rip-open: Using newly found fzf path for current search: ${updatedFzfPath}`
					);
				}

				// Extract directories and workspace files from parsed items
				const directories = new Set<string>();
				const workspaceFiles = new Set<string>();

				for (const item of parsedItems) {
					if (item.itemType === ItemType.Directory) {
						directories.add(item.fullPath);
					} else if (item.itemType === ItemType.WorkspaceFile) {
						workspaceFiles.add(item.fullPath);
					}
				} // Convert to array and prepare for fzf sorting
				const dirArray = Array.from(directories)
					.filter((dir) => {
						const dirName = path.basename(dir);
						return !dirName.startsWith("."); // Always exclude dot folders
					})
					.sort(); // Convert workspace files to array
				const workspaceArray = Array.from(workspaceFiles);

				if (foundFzfPaths.length > 0) {
					console.log(
						`rip-open: Found ${
							foundFzfPaths.length
						} fzf executable(s) during search: ${foundFzfPaths.join(", ")}`
					);
				}

				// Combine all items for fzf processing
				const allItems = [...dirArray, ...workspaceArray];

				if (allItems.length === 0) {
					resolve([]);
					return;
				}

				// Check if dataset is too large for fzf to handle efficiently
				const allItemsInput = allItems.join("\0") + "\0";
				const MAX_FZF_INPUT_SIZE = 500000; // 500KB limit
				const MAX_FZF_ITEMS = 5000; // 5000 items limit

				if (
					allItemsInput.length > MAX_FZF_INPUT_SIZE ||
					allItems.length > MAX_FZF_ITEMS
				) {
					console.log(
						`rip-open: Dataset too large for fzf (${allItemsInput.length} chars, ${allItems.length} items), using basic sorting`
					);
					// Fall back to basic sorting for large datasets
					const directoryItems: DirectoryItem[] = dirArray.map((fullPath) => ({
						label: path.basename(fullPath),
						description: fullPath,
						fullPath: fullPath,
						itemType: ItemType.Directory,
					}));

					const workspaceItems: DirectoryItem[] = workspaceArray.map(
						(fullPath) => ({
							label: path.basename(fullPath, ".code-workspace"),
							description: fullPath,
							fullPath: fullPath,
							itemType: ItemType.WorkspaceFile,
						})
					);

					const combinedItems = [...directoryItems, ...workspaceItems].sort(
						(a, b) => a.label.localeCompare(b.label)
					);

					resolve(combinedItems);
					return;
				}
				// Use fzf for enhanced sorting/ranking (ranking mode)
				// Using fzf without --filter to rank all items
				const baseRankingArgs = searchParams.fzfRankingArgs
					.split(" ")
					.filter((arg) => arg.trim());
				const fzfOptionsArgs = searchParams.fzfOptions
					.split(" ")
					.filter((arg) => arg.trim());
				const fzfArgs = [...baseRankingArgs, ...fzfOptionsArgs];
				console.log(
					`rip-open: Running fzf for ranking: ${
						searchParams.fzfPath
					} ${fzfArgs.join(" ")}`
				);
				console.log(
					`rip-open: Sending ${allItems.length} items (${allItemsInput.length} chars) to fzf for ranking`
				);
				console.log(
					`rip-open: Sample directories being sent to fzf: ${dirArray
						.slice(0, 5)
						.join(", ")}`
				);
				const fzfChild = spawn(searchParams.fzfPath, fzfArgs, {
					stdio: ["pipe", "pipe", "pipe"],
				});

				let fzfOutput = "";
				let fzfError = "";

				// Handle spawn errors (e.g., file not found)
				fzfChild.on("error", async (spawnError) => {
					console.warn(`rip-open: fzf spawn error: ${spawnError.message}`);

					// Clear the invalid cache entry
					await this.clearFzfCache(searchParams.fzfPath);

					// Fall back to basic alphabetical sorting
					const directories = dirArray.map((fullPath) => ({
						label: path.basename(fullPath),
						description: fullPath,
						fullPath: fullPath,
						itemType: ItemType.Directory,
					}));

					const workspaceItems = workspaceArray.map((fullPath) => ({
						label: path.basename(fullPath, ".code-workspace"),
						description: fullPath,
						fullPath: fullPath,
						itemType: ItemType.WorkspaceFile,
					}));

					const combinedItems = [...directories, ...workspaceItems].sort(
						(a, b) => a.label.localeCompare(b.label)
					);
					resolve(combinedItems);
				}); // Send combined list to fzf stdin
				console.log(
					`rip-open: Sending ${allItemsInput.length} characters to fzf stdin`
				);
				fzfChild.stdin?.write(allItemsInput);
				fzfChild.stdin?.end();

				fzfChild.stdout?.on("data", (data) => {
					fzfOutput += data.toString();
				});

				fzfChild.stderr?.on("data", (data) => {
					fzfError += data.toString();
				});

				// Handle cancellation
				token.onCancellationRequested(() => {
					fzfChild.kill();
					reject(new Error("Search was cancelled"));
				});

				fzfChild.on("close", (fzfCode) => {
					try {
						if (token.isCancellationRequested) {
							reject(new Error("Search was cancelled"));
							return;
						}

						if (fzfCode !== 0) {
							console.warn(
								`rip-open: fzf ranking failed with code ${fzfCode}: ${fzfError}, falling back to basic sorting`
							); // Fall back to basic alphabetical sorting
							const directories = dirArray.map((fullPath) => ({
								label: path.basename(fullPath),
								description: fullPath,
								fullPath: fullPath,
								itemType: ItemType.Directory,
							}));

							const workspaceItems = workspaceArray.map((fullPath) => ({
								label: path.basename(fullPath, ".code-workspace"),
								description: fullPath,
								fullPath: fullPath,
								itemType: ItemType.WorkspaceFile,
							}));

							const combinedItems = [...directories, ...workspaceItems];
							resolve(combinedItems);
							return;
						} // Parse fzf output (all items with fzf's ranking)
						const rankedItems = fzfOutput
							.split("\0")
							.filter((line) => line.trim())
							.map((fullPath) => {
								const isWorkspaceFile = fullPath.endsWith(".code-workspace");
								return {
									label: isWorkspaceFile
										? path.basename(fullPath, ".code-workspace")
										: path.basename(fullPath),
									description: fullPath,
									fullPath: fullPath,
									itemType: isWorkspaceFile
										? ItemType.WorkspaceFile
										: ItemType.Directory,
								};
							});

						console.log(`rip-open: fzf ranked ${rankedItems.length} items`);
						resolve(rankedItems);
					} catch (error) {
						console.warn(
							`rip-open: Error processing fzf output: ${error}, falling back to basic sorting`
						);
						// Fall back to basic sorting
						const directories = dirArray.map((fullPath) => ({
							label: path.basename(fullPath),
							description: fullPath,
							fullPath: fullPath,
							itemType: ItemType.Directory,
						}));

						const workspaceItems = workspaceArray.map((fullPath) => ({
							label: path.basename(fullPath, ".code-workspace"),
							description: fullPath,
							fullPath: fullPath,
							itemType: ItemType.WorkspaceFile,
						}));

						const combinedItems = [...directories, ...workspaceItems];
						resolve(combinedItems);
					}
				});
				fzfChild.on("error", (error) => {
					console.warn(
						`rip-open: Failed to run fzf: ${error.message}, falling back to basic search`
					);
					// Invalidate cache since fzf execution failed
					this.invalidateFzfCache(searchParams.fzfPath); // Fall back to basic sorting
					const directories = dirArray.map((fullPath) => ({
						label: path.basename(fullPath),
						description: fullPath,
						fullPath: fullPath,
						itemType: ItemType.Directory,
					}));

					const workspaceItems = workspaceArray.map((fullPath) => ({
						label: path.basename(fullPath, ".code-workspace"),
						description: fullPath,
						fullPath: fullPath,
						itemType: ItemType.WorkspaceFile,
					}));

					const combinedItems = [...directories, ...workspaceItems];
					resolve(combinedItems);
				}); // Send combined list to fzf
				fzfChild.stdin?.write(allItemsInput);
				fzfChild.stdin?.end();
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Update the fzf path configuration if we found better fzf executables
	 */
	private static async _updateFzfPathIfBetter(
		foundFzfPaths: string[],
		currentFzfPath: string
	): Promise<string> {
		if (foundFzfPaths.length === 0) {
			return currentFzfPath;
		}
		// Update fzf path if:
		// 1. Current path is "fzf" (default) and we found actual paths, OR
		// 2. Current path doesn't exist and we found better paths
		const shouldUpdate =
			currentFzfPath === "fzf" ||
			(currentFzfPath !== "fzf" &&
				!FileUtils.existsSync(currentFzfPath) &&
				foundFzfPaths.length > 0);

		if (shouldUpdate) {
			// Prefer paths that are in common binary directories
			const preferredPaths = foundFzfPaths.filter(
				(fzfPath) =>
					fzfPath.includes("/bin/") ||
					fzfPath.includes("\\bin\\") ||
					fzfPath.includes("/usr/") ||
					fzfPath.includes("Program Files")
			);
			const bestPath =
				preferredPaths.length > 0 ? preferredPaths[0] : foundFzfPaths[0];

			// Update the configuration (this will be used for subsequent searches)
			try {
				vscode.workspace
					.getConfiguration("ripOpen")
					.update("fzfPath", bestPath, vscode.ConfigurationTarget.Global);
				console.log(`rip-open: Updated fzf path to: ${bestPath}`);

				// Update the cache to mark the new path as available
				if (this._extensionContext) {
					// Clear any old cache entries for the previous path
					const oldCacheKey = `fzf-availability-${currentFzfPath}`;
					await this._extensionContext.globalState.update(
						oldCacheKey,
						undefined
					);

					// Set the new path as available in cache
					const newCacheKey = `fzf-availability-${bestPath}`;
					await this._extensionContext.globalState.update(newCacheKey, {
						available: true,
					});
					console.log(
						`rip-open: Updated fzf availability cache for: ${bestPath}`
					);
				}
			} catch (error) {
				console.warn(`rip-open: Failed to update fzf path: ${error}`);
			}

			return bestPath;
		}

		return currentFzfPath;
	}
	/**
	 * Extract all directory paths from a file path and add them to the directories set.
	 * This captures intermediate directories that might only contain subdirectories.
	 */ private static _extractAllDirectoryPaths(
		filePath: string,
		directories: Set<string>,
		searchPaths: string[]
	): void {
		let currentPath = path.dirname(filePath);

		// Keep going up the directory tree until we reach a search path root or can't go further
		while (
			currentPath &&
			currentPath !== "." &&
			currentPath !== path.dirname(currentPath)
		) {
			directories.add(currentPath);

			// Check if we've reached one of the search path roots
			const isSearchRoot = searchPaths.some((searchPath) => {
				const normalizedSearchPath = path.resolve(searchPath);
				const normalizedCurrentPath = path.resolve(currentPath);
				return normalizedCurrentPath === normalizedSearchPath;
			});

			if (isSearchRoot) {
				break;
			}

			currentPath = path.dirname(currentPath);
		}
	}
}
