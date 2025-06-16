import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { DirectoryItem, SearchParams } from "./types";
import { ConfigurationManager } from "./configuration";

export class DirectorySearcher {
	private static readonly RG_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
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
					console.log(`fd-palette: Found bundled ripgrep at: ${rgPath}`);
					return rgPath;
				}
			}

			console.log("fd-palette: No bundled ripgrep found in common locations");
			return null;
		} catch (error) {
			console.warn("fd-palette: Error detecting bundled ripgrep:", error);
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

		// Check persistent cache first
		const cacheKey = "ripgrep-availability";
		const cached = this._extensionContext.globalState.get<{
			available: boolean;
			path: string;
			timestamp: number;
		}>(cacheKey);
		const now = Date.now();

		if (cached && now - cached.timestamp < this.RG_CACHE_DURATION) {
			if (cached.available) {
				console.log(
					`fd-palette: ripgrep availability cache HIT - available: ${cached.path}`
				);
				return cached.path;
			} else {
				console.log(
					"fd-palette: ripgrep availability cache HIT - not available"
				);
				throw new Error("ripgrep command failed (cached result)");
			}
		}

		console.log("fd-palette: ripgrep availability cache MISS, checking...");

		// Not cached or expired, check availability
		try {
			const rgPath = await this._getAvailableRipgrepPath();
			console.log(
				`fd-palette: ripgrep availability check passed, caching result: ${rgPath}`
			);

			// Cache the successful result
			await this._extensionContext.globalState.update(cacheKey, {
				available: true,
				path: rgPath,
				timestamp: now,
			});

			return rgPath;
		} catch (error) {
			console.log(
				`fd-palette: ripgrep availability check failed, caching result: ${error}`
			);

			// Cache the failure
			await this._extensionContext.globalState.update(cacheKey, {
				available: false,
				path: "",
				timestamp: now,
			});

			throw error;
		}
	}

	/**
	 * Get the first available ripgrep path
	 */
	private static async _getAvailableRipgrepPath(): Promise<string> {
		// First try bundled ripgrep
		const bundledRg = this.getBundledRipgrepPath();
		if (bundledRg) {
			try {
				await this._runRipgrepAvailabilityCheck(bundledRg);
				return bundledRg;
			} catch (error) {
				console.warn(
					"fd-palette: Bundled ripgrep failed availability check:",
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

		// Check persistent cache first
		const cacheKey = `fzf-availability-${fzfPath}`;
		const cached = this._extensionContext.globalState.get<{
			available: boolean;
			timestamp: number;
		}>(cacheKey);
		const now = Date.now();

		if (cached && now - cached.timestamp < this.RG_CACHE_DURATION) {
			if (cached.available) {
				console.log(`fd-palette: fzf availability cache HIT - available: ${fzfPath}`);
				return Promise.resolve();
			} else {
				console.log(`fd-palette: fzf availability cache HIT - not available: ${fzfPath}`);
				return Promise.reject(new Error("fzf command failed (cached result)"));
			}
		}

		console.log(`fd-palette: fzf availability cache MISS for: ${fzfPath}, checking...`);

		// Not cached or expired, check availability
		try {
			await this._runFzfAvailabilityCheck(fzfPath);
			console.log(`fd-palette: fzf availability check passed, caching result: ${fzfPath}`);

			// Cache the successful result
			await this._extensionContext.globalState.update(cacheKey, {
				available: true,
				timestamp: now,
			});
		} catch (error) {
			console.log(`fd-palette: fzf availability check failed, caching result: ${fzfPath}`);

			// Cache the failed result
			await this._extensionContext.globalState.update(cacheKey, {
				available: false,
				timestamp: now,
			});
			throw error;
		}
	}

	/**
	 * Run fzf availability check
	 */
	private static async _runFzfAvailabilityCheck(fzfPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const process = spawn(fzfPath, ["--version"], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let output = "";
			process.stdout?.on("data", (data) => {
				output += data.toString();
			});			process.on("close", (code) => {
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
	 * Find directories using ripgrep
	 */
	static async findDirectories(
		searchParams: SearchParams,
		token: vscode.CancellationToken
	): Promise<DirectoryItem[]> {
		return new Promise(async (resolve, reject) => {
			try {
				// Get available ripgrep path
				const rgPath = await this.checkRipgrepAvailability();

				// Get the valid search path
				const searchPath = await ConfigurationManager.getValidSearchPath();

				const args: string[] = [
					"--files", // List files (we'll filter directories from the output)
					"--null", // Use null separator for better parsing
					"--hidden", // Include hidden files/directories
					"--no-ignore", // Don't respect .gitignore initially (we'll filter ourselves)
					"--max-depth",
					searchParams.maxDepth.toString(),
				];

				// Add exclude patterns using ripgrep's glob syntax
				for (const pattern of searchParams.excludePatterns) {
					args.push("--glob", `!${pattern}`);
				}

				// Add search path
				if (searchPath && searchPath.trim()) {
					args.push(searchPath);
				}

				console.log(`fd-palette: Running ripgrep: ${rgPath} ${args.join(" ")}`);

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
					reject(new Error("Search was cancelled"));
				});

				child.on("close", (code) => {
					try {
						if (token.isCancellationRequested) {
							reject(new Error("Search was cancelled"));
							return;
						}

						if (code !== 0 && code !== 1) {
							// ripgrep exits with 1 when no matches found, which is normal
							console.error(`fd-palette: ripgrep stderr: ${stderr}`);
							reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
							return;
						}

						// Parse ripgrep output to extract directories
						const directories = this._parseRipgrepOutput(stdout);
						console.log(
							`fd-palette: Found ${directories.length} directories using ripgrep`
						);
						resolve(directories);
					} catch (error) {
						reject(error);
					}
				});

				child.on("error", (error) => {
					reject(new Error(`Failed to run ripgrep: ${error.message}`));
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Parse ripgrep output to extract unique directories
	 */
	private static _parseRipgrepOutput(output: string): DirectoryItem[] {
		if (!output.trim()) {
			return [];
		}

		const directories = new Set<string>();
		const lines = output.split("\0").filter((line) => line.trim()); // Split by null separator

		// Extract directory paths from file paths
		for (const filePath of lines) {
			if (filePath.trim()) {
				const dirPath = path.dirname(filePath);
				directories.add(dirPath);
			}
		}

		// Convert to DirectoryItem array and sort
		const directoryItems: DirectoryItem[] = Array.from(directories)
			.filter((dir) => {
				// Filter out common undesirable directories
				const dirName = path.basename(dir);
				return (
					!dirName.startsWith(".") ||
					ConfigurationManager.shouldExcludeHomeDotFolders() === false
				);
			})
			.map((fullPath) => ({
				label: path.basename(fullPath),
				description: fullPath,
				fullPath: fullPath,
			}))
			.sort((a, b) => a.label.localeCompare(b.label));

		return directoryItems;
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

				// Get the valid search path
				const searchPath = await ConfigurationManager.getValidSearchPath();

				// First, run ripgrep to get all files
				const rgArgs: string[] = [
					"--files", // List files
					"--null", // Use null separator
					"--hidden", // Include hidden files
					"--no-ignore", // Don't respect .gitignore initially
					"--max-depth", (searchParams.maxDepth + 2).toString(), // Search deeper when fzf is available
				];

				// Add exclude patterns
				for (const pattern of searchParams.excludePatterns) {
					rgArgs.push("--glob", `!${pattern}`);
				}

				if (searchPath && searchPath.trim()) {
					rgArgs.push(searchPath);
				}

				console.log(`fd-palette: Running ripgrep for fzf: ${rgPath} ${rgArgs.join(" ")}`);

				const rgChild = spawn(rgPath, rgArgs, {
					stdio: ["ignore", "pipe", "pipe"],
				});

				let rgOutput = "";
				let rgError = "";

				rgChild.stdout?.on("data", (data) => {
					rgOutput += data.toString();
				});

				rgChild.stderr?.on("data", (data) => {
					rgError += data.toString();
				});

				// Handle cancellation
				token.onCancellationRequested(() => {
					rgChild.kill();
					reject(new Error("Search was cancelled"));
				});

				rgChild.on("close", async (rgCode) => {
					try {
						if (token.isCancellationRequested) {
							reject(new Error("Search was cancelled"));
							return;
						}

						if (rgCode !== 0 && rgCode !== 1) {
							console.error(`fd-palette: ripgrep stderr: ${rgError}`);
							reject(new Error(`ripgrep failed with code ${rgCode}: ${rgError}`));
							return;
						}

						// Extract unique directories from ripgrep output
						const directories = new Set<string>();
						const lines = rgOutput.split('\0').filter(line => line.trim());

						for (const filePath of lines) {
							if (filePath.trim()) {
								const dirPath = path.dirname(filePath);
								directories.add(dirPath);
							}
						}

						// Convert to array and prepare for fzf sorting
						const dirArray = Array.from(directories)
							.filter(dir => {
								const dirName = path.basename(dir);
								return !dirName.startsWith('.') || ConfigurationManager.shouldExcludeHomeDotFolders() === false;
							})
							.sort();

						if (dirArray.length === 0) {
							resolve([]);
							return;
						}

						// Use fzf for enhanced sorting/ranking (non-interactive mode)
						// We'll pass all directories through fzf to get better ranking
						const fzfArgs = [
							"--filter", "", // Non-interactive mode with empty filter (returns all items with fzf ranking)
							"--no-info", // Don't show info line
							"--no-scrollbar", // Don't show scrollbar
							"--print0", // Use null separator for output
						];

						console.log(`fd-palette: Running fzf for ranking: ${searchParams.fzfPath} ${fzfArgs.join(" ")}`);

						const fzfChild = spawn(searchParams.fzfPath, fzfArgs, {
							stdio: ["pipe", "pipe", "pipe"],
						});

						let fzfOutput = "";
						let fzfError = "";

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
									console.warn(`fd-palette: fzf ranking failed with code ${fzfCode}: ${fzfError}, falling back to basic sorting`);
									// Fall back to basic alphabetical sorting
									const directories = dirArray.map(fullPath => ({
										label: path.basename(fullPath),
										description: fullPath,
										fullPath: fullPath,
									}));
									resolve(directories);
									return;
								}

								// Parse fzf output (should be all directories with fzf's ranking)
								const rankedDirs = fzfOutput
									.split('\0')
									.filter(line => line.trim())
									.map(fullPath => ({
										label: path.basename(fullPath),
										description: fullPath,
										fullPath: fullPath,
									}));

								console.log(`fd-palette: fzf ranked ${rankedDirs.length} directories`);
								resolve(rankedDirs);
							} catch (error) {
								console.warn(`fd-palette: Error processing fzf output: ${error}, falling back to basic sorting`);
								// Fall back to basic sorting
								const directories = dirArray.map(fullPath => ({
									label: path.basename(fullPath),
									description: fullPath,
									fullPath: fullPath,
								}));
								resolve(directories);
							}
						});

						fzfChild.on("error", (error) => {
							console.warn(`fd-palette: Failed to run fzf: ${error.message}, falling back to basic search`);
							// Fall back to basic sorting
							const directories = dirArray.map(fullPath => ({
								label: path.basename(fullPath),
								description: fullPath,
								fullPath: fullPath,
							}));
							resolve(directories);
						});

						// Send directory list to fzf
						fzfChild.stdin?.write(dirArray.join('\n'));
						fzfChild.stdin?.end();

					} catch (error) {
						reject(error);
					}
				});

				rgChild.on("error", (error) => {
					reject(new Error(`Failed to run ripgrep: ${error.message}`));
				});

			} catch (error) {
				reject(error);
			}
		});
	}
}
