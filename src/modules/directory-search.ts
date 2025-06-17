import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { DirectoryItem, SearchParams, ItemType } from "./types";
import { ConfigurationManager } from "./configuration";

export class DirectorySearcher {
	private static _extensionContext: vscode.ExtensionContext | undefined;

	static setExtensionContext(context: vscode.ExtensionContext): void {
		this._extensionContext = context;
	}

	/**
	 * Attempts to find VS Code's bundled ripgrep executable
	 */
	static getBundledRipgrepPath(): string | null {
		try {
			// Try to get VS Code's installation path
			const possiblePaths = [
				// VS Code Insiders
				path.join(
					os.homedir(),
					"AppData",
					"Local",
					"Programs",
					"Microsoft VS Code Insiders",
					"resources",
					"app",
					"node_modules",
					"@vscode",
					"ripgrep",
					"bin",
					"rg.exe"
				),
				// Regular VS Code
				path.join(
					os.homedir(),
					"AppData",
					"Local",
					"Programs",
					"Microsoft VS Code",
					"resources",
					"app",
					"node_modules",
					"@vscode",
					"ripgrep",
					"bin",
					"rg.exe"
				),
				// VS Code Portable
				path.join(
					process.env.VSCODE_PORTABLE || "",
					"resources",
					"app",
					"node_modules",
					"@vscode",
					"ripgrep",
					"bin",
					"rg.exe"
				),
				// macOS paths
				"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
				"/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
				// Linux paths
				"/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
				"/opt/visual-studio-code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
			];

			for (const rgPath of possiblePaths) {
				if (fs.existsSync(rgPath)) {
					console.log(`rip-open: Found bundled ripgrep at: ${rgPath}`);
					return rgPath;
				}
			}

			console.log("rip-open: No bundled ripgrep found in common locations");
			return null;
		} catch (error) {
			console.warn("rip-open: Error detecting bundled ripgrep:", error);
			return null;
		}
	}
	/**
	 * Check if ripgrep is available (either bundled or in PATH)
	 */
	static async checkRipgrepAvailability(): Promise<string> {
		if (!this._extensionContext) {
			// Fallback if context not set - just run the check
			return this._getAvailableRipgrepPath();
		}

		// Check persistent cache first (no time-based expiration)
		const cacheKey = "ripgrep-availability";
		const cached = this._extensionContext.globalState.get<{
			available: boolean;
			path: string;
		}>(cacheKey);

		if (cached) {
			if (cached.available) {
				console.log(
					`rip-open: ripgrep availability cache HIT - available: ${cached.path}`
				);
				return cached.path;
			} else {
				console.log("rip-open: ripgrep availability cache HIT - not available");
				throw new Error("ripgrep command failed (cached result)");
			}
		}
		// ripgrep availability cache MISS, checking...

		// Not cached, check availability
		try {
			const rgPath = await this._getAvailableRipgrepPath();
			// ripgrep availability check passed, caching result

			// Cache the successful result (no timestamp needed)
			await this._extensionContext.globalState.update(cacheKey, {
				available: true,
				path: rgPath,
			});

			return rgPath;
		} catch (error) {
			console.log(
				`rip-open: ripgrep availability check failed, caching result: ${error}`
			);

			// Cache the failure (no timestamp needed)
			await this._extensionContext.globalState.update(cacheKey, {
				available: false,
				path: "",
			});

			throw error;
		}
	}

	/**
	 * Invalidate ripgrep availability cache (call when ripgrep execution fails)
	 */
	static async invalidateRipgrepCache(): Promise<void> {
		if (this._extensionContext) {
			const cacheKey = "ripgrep-availability";
			await this._extensionContext.globalState.update(cacheKey, undefined);
			console.log("rip-open: ripgrep availability cache invalidated");
		}
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
		const bundledRg = this.getBundledRipgrepPath();
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
		return new Promise((resolve, reject) => {
			const process = spawn(rgPath, ["--version"], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let output = "";
			process.stdout?.on("data", (data) => {
				output += data.toString();
			});

			process.on("close", (code) => {
				if (code === 0 && output.includes("ripgrep")) {
					resolve();
				} else {
					reject(new Error(`ripgrep check failed with code ${code}`));
				}
			});

			process.on("error", (error) => {
				reject(error);
			});
		});
	}
	/**
	 * Check if fzf is available (for enhanced fuzzy matching)
	 */
	static async checkFzfAvailability(fzfPath: string): Promise<void> {
		if (!this._extensionContext) {
			// Fallback if context not set - just run the check
			return this._runFzfAvailabilityCheck(fzfPath);
		}

		// Check persistent cache first (no time-based expiration)
		const cacheKey = `fzf-availability-${fzfPath}`;
		const cached = this._extensionContext.globalState.get<{
			available: boolean;
		}>(cacheKey);

		if (cached) {
			if (cached.available) {
				console.log(
					`rip-open: fzf availability cache HIT - available: ${fzfPath}`
				);
				return Promise.resolve();
			} else {
				console.log(
					`rip-open: fzf availability cache HIT - not available: ${fzfPath}`
				);
				return Promise.reject(new Error("fzf command failed (cached result)"));
			}
		}

		console.log(
			`rip-open: fzf availability cache MISS for: ${fzfPath}, checking...`
		);

		// Not cached, check availability
		try {
			await this._runFzfAvailabilityCheck(fzfPath);
			console.log(
				`rip-open: fzf availability check passed, caching result: ${fzfPath}`
			);

			// Cache the successful result (no timestamp needed)
			await this._extensionContext.globalState.update(cacheKey, {
				available: true,
			});
		} catch (error) {
			console.log(
				`rip-open: fzf availability check failed, caching result: ${fzfPath}`
			);

			// Cache the failed result (no timestamp needed)
			await this._extensionContext.globalState.update(cacheKey, {
				available: false,
			});
			throw error;
		}
	}

	/**
	 * Invalidate fzf availability cache (call when fzf execution fails)
	 */
	static async invalidateFzfCache(fzfPath: string): Promise<void> {
		if (this._extensionContext) {
			const cacheKey = `fzf-availability-${fzfPath}`;
			await this._extensionContext.globalState.update(cacheKey, undefined);
			console.log(
				`rip-open: fzf availability cache invalidated for: ${fzfPath}`
			);
		}
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

			// If no search paths, search from root
			if (!searchPaths || searchPaths.length === 0) {
				searchPaths = [""];
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
				"--max-depth",
				searchParams.maxDepth.toString(),
			];

			// Add configurable options
			if (searchParams.includeHidden) {
				baseArgs.push("--hidden");
			}
			if (!searchParams.respectGitignore) {
				baseArgs.push("--no-ignore");
			}

			// Add additional user-specified ripgrep arguments
			baseArgs.push(...searchParams.additionalRipgrepArgs);

			// Add exclude patterns using ripgrep's glob syntax
			for (const pattern of searchParams.excludePatterns) {
				baseArgs.push("--glob", `!${pattern}`);
			}

			console.log(
				`rip-open: Search paths: ${
					searchPaths.length > 0 ? searchPaths.join(", ") : "none (root search)"
				}`
			);
			console.log(
				`rip-open: Max depth: ${searchParams.maxDepth}, Include hidden: ${searchParams.includeHidden}, Respect gitignore: ${searchParams.respectGitignore}`
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
			); // Parse ripgrep output to extract directories and workspace files
			const results = this._parseRipgrepOutput(
				stdout,
				searchParams.includeWorkspaceFiles,
				searchPaths
			);
			console.log(
				`rip-open: Found ${results.length} directories using ripgrep across ${
					searchPaths.length || "root"
				} search paths`
			);

			return results;
		} catch (error) {
			throw error;
		}
	}
	/**
	 * Parse ripgrep output to extract unique directories and workspace files
	 */
	private static _parseRipgrepOutput(
		output: string,
		includeWorkspaceFiles: boolean = false,
		searchPaths: string[] = []
	): DirectoryItem[] {
		const directories = new Set<string>();
		const workspaceFiles = new Set<string>();
		const lines = output.split("\0").filter((line) => line.trim());
		// Extract directory paths and workspace files
		for (const filePath of lines) {
			if (filePath.trim()) {
				if (includeWorkspaceFiles && filePath.endsWith(".code-workspace")) {
					workspaceFiles.add(filePath);
				}

				// Extract all directory path segments from the file path
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
				const shouldExcludeDotFolders =
					ConfigurationManager.shouldExcludeHomeDotFolders();
				const isDotFolder = dirName.startsWith(".");
				return !isDotFolder || !shouldExcludeDotFolders;
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
		return allItems;
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
				const rgPath = await this.checkRipgrepAvailability();
				// Get all valid search paths
				const searchPaths = await ConfigurationManager.getValidSearchPaths(); // First, run ripgrep to get all files
				const baseArgs: string[] = [
					"--files", // List files
					"--null", // Use null separator
					"--max-depth",
					(searchParams.maxDepth + 2).toString(), // Search deeper when fzf is available
				];

				// Add configurable options
				if (searchParams.includeHidden) {
					baseArgs.push("--hidden");
				}
				if (!searchParams.respectGitignore) {
					baseArgs.push("--no-ignore");
				}

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
					`rip-open: Max depth: ${searchParams.maxDepth + 2}, Include hidden: ${
						searchParams.includeHidden
					}, Respect gitignore: ${searchParams.respectGitignore}`
				);

				// Run ripgrep across all search paths
				const rgOutput = await this._runRipgrepMultiplePaths(
					rgPath,
					baseArgs,
					searchPaths,
					token
				); // Extract unique directories and workspace files from ripgrep output
				const directories = new Set<string>();
				const workspaceFiles = new Set<string>();
				const lines = rgOutput
					.split("\0")
					.filter((line: string) => line.trim());

				for (const filePath of lines) {
					if (filePath.trim()) {
						// Check if this is a workspace file
						if (
							searchParams.includeWorkspaceFiles &&
							filePath.endsWith(".code-workspace")
						) {
							workspaceFiles.add(filePath);
						} // Always add the directory path and all intermediate paths
						this._extractAllDirectoryPaths(filePath, directories, searchPaths);
					}
				} // Add root-level subdirectories to capture folders without files
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

				// Convert to array and prepare for fzf sorting
				const dirArray = Array.from(directories)
					.filter((dir) => {
						const dirName = path.basename(dir);
						return (
							!dirName.startsWith(".") ||
							ConfigurationManager.shouldExcludeHomeDotFolders() === false
						);
					})
					.sort();

				// Convert workspace files to array
				const workspaceArray = Array.from(workspaceFiles);

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

				// Use fzf for enhanced sorting/ranking (filter mode)
				// Using empty filter should return all items with fzf's ranking
				const fzfArgs = [
					"--filter", // Non-interactive filter mode
					"--read0", // Read null-separated input
					"--print0", // Use null separator for output
					"--no-info", // Don't show info line
					"--no-scrollbar", // Don't show scrollbar
				];
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
				let fzfError = ""; // Send combined list to fzf stdin
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
	 * Extract all directory paths from a file path and add them to the directories set.
	 * This captures intermediate directories that might only contain subdirectories.
	 */
	private static _extractAllDirectoryPaths(
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
