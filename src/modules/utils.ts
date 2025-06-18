import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { spawn } from "child_process";

export class PathUtils {
	/**
	 * Attempts to find VS Code's bundled ripgrep executable
	 * Supports multiple VS Code variants: Stable, Insiders, Exploration, VSCodium, Cursor
	 * Checks various installation methods: standard, portable, Microsoft Store, Snap, Flatpak, Homebrew, AppImage
	 */
	static getBundledRipgrepPath(): string | null {
		try {
			// Try to get VS Code's installation path
			const homeDir = os.homedir();
			const isWindows = process.platform === "win32";
			const isMac = process.platform === "darwin";
			const isLinux = process.platform === "linux";

			const possiblePaths = [
				// Windows paths
				...(isWindows
					? [
							// VS Code Stable
							path.join(
								homeDir,
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
							// VS Code Insiders
							path.join(
								homeDir,
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
							// VS Code Exploration (Canary)
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Microsoft VS Code Exploration",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VSCodium
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"VSCodium",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// Cursor Editor
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Cursor",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VS Code from Microsoft Store
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Microsoft",
								"WindowsApps",
								"Microsoft.VisualStudioCode_8wekyb3d8bbwe",
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
							// System-wide installations
							"C:\\Program Files\\Microsoft VS Code\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
							"C:\\Program Files (x86)\\Microsoft VS Code\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
							"C:\\Program Files\\VSCodium\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
					  ]
					: []),

				// macOS paths
				...(isMac
					? [
							// VS Code Stable
							"/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VS Code Insiders
							"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VS Code Exploration
							"/Applications/Visual Studio Code - Exploration.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VSCodium
							"/Applications/VSCodium.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Cursor Editor
							"/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Homebrew installations
							"/opt/homebrew/Cellar/visual-studio-code/*/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/usr/local/Cellar/visual-studio-code/*/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
					  ]
					: []),

				// Linux paths
				...(isLinux
					? [
							// Standard installations
							"/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/opt/visual-studio-code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VSCodium
							"/usr/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/opt/vscodium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Snap installations
							"/snap/code/current/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/snap/codium/current/usr/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Flatpak installations
							path.join(
								homeDir,
								".local/share/flatpak/app/com.visualstudio.code/current/active/files/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							path.join(
								homeDir,
								".local/share/flatpak/app/com.vscodium.codium/current/active/files/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							// AppImage installations (common locations)
							path.join(
								homeDir,
								".local/bin/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							path.join(
								homeDir,
								"Applications/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							// Cursor Editor
							"/opt/cursor/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							path.join(
								homeDir,
								".local/share/cursor/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
					  ]
					: []),
			];

			for (const rgPath of possiblePaths) {
				if (fs.existsSync(rgPath)) {
					console.log(`rip-scope: Found bundled ripgrep at: ${rgPath}`);
					return rgPath;
				}
			}

			console.log("rip-scope: No bundled ripgrep found in common locations");
			return null;
		} catch (error) {
			console.warn("rip-scope: Error detecting bundled ripgrep:", error);
			return null;
		}
	}
}

export class ProcessUtils {
	/**
	 * Check if a command is available by running it with --version
	 */
	static async checkCommandAvailability(
		commandPath: string,
		expectedOutput?: string
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const process = spawn(commandPath, ["--version"], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let output = "";
			process.stdout?.on("data", (data) => {
				output += data.toString();
			});

			process.on("close", (code) => {
				if (code === 0) {
					// If expectedOutput is provided, check for it in the output
					if (expectedOutput && !output.includes(expectedOutput)) {
						reject(
							new Error(
								`${commandPath} check failed - expected output not found`
							)
						);
					} else {
						resolve();
					}
				} else {
					reject(new Error(`${commandPath} check failed with code ${code}`));
				}
			});

			process.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Spawn a process with standard error handling
	 */
	static spawnWithErrorHandling(
		command: string,
		args: string[],
		options: any = {}
	) {
		const defaultOptions = {
			stdio: ["pipe", "pipe", "pipe"],
			...options,
		};

		return spawn(command, args, defaultOptions);
	}
}

export class FileUtils {
	private static _handleSync<T>(fn: () => T, errorMsg: string, fallback: T): T {
		try {
			return fn();
		} catch (error) {
			console.warn(errorMsg, error);
			return fallback;
		}
	}

	private static async _handleAsync<T>(
		fn: () => Promise<T>,
		errorMsg: string,
		fallback: T
	): Promise<T> {
		try {
			return await fn();
		} catch (error) {
			console.warn(errorMsg, error);
			return fallback;
		}
	}

	static existsSync(filePath: string): boolean {
		return this._handleSync(
			() => fs.existsSync(filePath),
			`rip-scope: Error checking file existence for ${filePath}:`,
			false
		);
	}

	static async readFile(
		filePath: string,
		encoding: BufferEncoding = "utf8"
	): Promise<string | null> {
		return this._handleAsync(
			() => fs.promises.readFile(filePath, encoding),
			`rip-scope: Error reading file ${filePath}:`,
			null
		);
	}

	static readFileSync(
		filePath: string,
		encoding: BufferEncoding = "utf8"
	): string | null {
		return this._handleSync(
			() => fs.readFileSync(filePath, encoding),
			`rip-scope: Error reading file (sync) ${filePath}:`,
			null
		);
	}

	static async writeFile(
		filePath: string,
		data: string,
		encoding: BufferEncoding = "utf8"
	): Promise<boolean> {
		return this._handleAsync(
			() => fs.promises.writeFile(filePath, data, encoding).then(() => true),
			`rip-scope: Error writing file ${filePath}:`,
			false
		);
	}

	static async mkdir(
		dirPath: string,
		recursive: boolean = true
	): Promise<boolean> {
		return this._handleAsync(
			() => fs.promises.mkdir(dirPath, { recursive }).then(() => true),
			`rip-scope: Error creating directory ${dirPath}:`,
			false
		);
	}

	static mkdirSync(dirPath: string, recursive: boolean = true): boolean {
		return this._handleSync(
			() => {
				fs.mkdirSync(dirPath, { recursive });
				return true;
			},
			`rip-scope: Error creating directory (sync) ${dirPath}:`,
			false
		);
	}

	static readdirSync(dirPath: string): string[] {
		return this._handleSync(
			() => fs.readdirSync(dirPath),
			`rip-scope: Error reading directory (sync) ${dirPath}:`,
			[]
		);
	}

	static async createDirectory(dirPath: string): Promise<void> {
		const success = await this.mkdir(dirPath, true);
		if (!success) {
			throw new Error(`Failed to create directory: ${dirPath}`);
		}
	}
}

export class MessageUtils {
	private static async _show(
		type: "info" | "warning" | "error",
		message: string,
		timeout?: number
	): Promise<void> {
		let promise: Thenable<string | undefined>;
		switch (type) {
			case "info":
				promise = vscode.window.showInformationMessage(message);
				break;
			case "warning":
				promise = vscode.window.showWarningMessage(message);
				break;
			case "error":
				promise = vscode.window.showErrorMessage(message);
				break;
			default:
				promise = vscode.window.showInformationMessage(message);
				break;
		}
		if (timeout) {
			setTimeout(() => {
				// No direct way to dismiss messages in VS Code
			}, timeout);
		}
		await promise;
	}

	static async showInfo(message: string, timeout?: number): Promise<void> {
		await this._show("info", message, timeout);
	}

	static async showWarning(message: string, timeout?: number): Promise<void> {
		await this._show("warning", message, timeout);
	}

	static async showError(message: string, timeout?: number): Promise<void> {
		await this._show("error", message, timeout);
	}

	static async showWithActions(
		type: "info" | "warning" | "error",
		message: string,
		...actions: string[]
	): Promise<string | undefined> {
		switch (type) {
			case "info":
				return await vscode.window.showInformationMessage(message, ...actions);
			case "warning":
				return await vscode.window.showWarningMessage(message, ...actions);
			case "error":
				return await vscode.window.showErrorMessage(message, ...actions);
			default:
				return await vscode.window.showInformationMessage(message, ...actions);
		}
	}
	/**
	 * Show a success message with "Open with Code" and "Add to Workspace" action buttons
	 * @param message The success message to display
	 * @param items Array of DirectoryItem objects for the actions, or a single folder path string
	 * @param addToWorkspaceCallback Optional callback function to handle adding to workspace
	 */
	static async showFolderActionDialog(
		message: string,
		items: any[] | string,
		addToWorkspaceCallback?: () => Promise<void>
	): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			message,
			"Open with Code",
			"Add to Workspace"
		);

		if (choice === "Open with Code") {
			let folderPath: string;
			if (typeof items === "string") {
				folderPath = items;
			} else if (items.length === 1) {
				// Single item - open it directly
				folderPath = items[0].fullPath || items[0];
			} else {
				// Multiple items - open the parent directory
				const firstPath = items[0].fullPath || items[0];
				folderPath = require("path").dirname(firstPath);
			}

			await vscode.commands.executeCommand(
				"vscode.openFolder",
				vscode.Uri.file(folderPath),
				false // Open in current window
			);
		} else if (choice === "Add to Workspace" && addToWorkspaceCallback) {
			await addToWorkspaceCallback();
		}
	}
}

export class HashUtils {
	/**
	 * Generate a consistent hash for cache keys
	 */
	static generateHash(input: string): string {
		return crypto.createHash("md5").update(input).digest("hex").substring(0, 8);
	}

	/**
	 * Generate a cache key with consistent formatting
	 */
	static generateCacheKey(prefix: string, ...parts: string[]): string {
		const combined = parts.join("-");
		const hash = this.generateHash(combined);
		return `${prefix}-${hash}`;
	}

	/**
	 * Generate a cache key for command availability
	 */
	static generateAvailabilityCacheKey(command: string, path?: string): string {
		const parts = path ? [command, path] : [command];
		return this.generateCacheKey("availability", ...parts);
	}
}

export class CommandAvailabilityUtils {
	static async checkAvailability(
		extensionContext: vscode.ExtensionContext | undefined,
		cacheKey: string,
		commandPath: string,
		expectedOutput?: string
	): Promise<string | void> {
		if (!extensionContext) {
			// No context, just check
			await ProcessUtils.checkCommandAvailability(commandPath, expectedOutput);
			return commandPath;
		}
		const cached = extensionContext.globalState.get<{
			available: boolean;
			path?: string;
		}>(cacheKey);
		if (cached) {
			if (cached.available) {
				return cached.path || commandPath;
			} else {
				throw new Error(`${commandPath} command failed (cached result)`);
			}
		}
		try {
			await ProcessUtils.checkCommandAvailability(commandPath, expectedOutput);
			await extensionContext.globalState.update(cacheKey, {
				available: true,
				path: commandPath,
			});
			return commandPath;
		} catch (error) {
			await extensionContext.globalState.update(cacheKey, {
				available: false,
				path: commandPath,
			});
			throw error;
		}
	}

	static async invalidateCache(
		extensionContext: vscode.ExtensionContext | undefined,
		cacheKey: string
	): Promise<void> {
		if (extensionContext) {
			await extensionContext.globalState.update(cacheKey, undefined);
		}
	}
}
