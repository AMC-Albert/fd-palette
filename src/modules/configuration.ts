import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SearchParams } from "./types";

export class ConfigurationManager {
	private static readonly CONFIG_SECTION = "ripOpen";
	private static readonly PATH_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
	private static _extensionContext: vscode.ExtensionContext | undefined;

	static setExtensionContext(context: vscode.ExtensionContext): void {
		this._extensionContext = context;
	}
	static getSearchParams(): SearchParams {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		const searchPaths = config.get<string[]>("searchPath") || [];
		return {
			searchPath: searchPaths,
			maxDepth: config.get<number>("maxDepth") || 5,
			excludePatterns: config.get<string[]>("excludePatterns") || [],
			ripgrepPath: config.get<string>("ripgrepPath") || "auto",
			fzfPath: config.get<string>("fzfPath") || "fzf",
			enableFzf: config.get<boolean>("enableFzf") ?? true,
			fzfOptions:
				config.get<string>("fzfOptions") ||
				"--height=60% --layout=reverse --border --info=inline --cycle",
			includeHidden: config.get<boolean>("includeHidden") ?? true,
			respectGitignore: config.get<boolean>("respectGitignore") ?? false,
			additionalRipgrepArgs:
				config.get<string[]>("additionalRipgrepArgs") || [],
			boostGitDirectories: config.get<boolean>("boostGitDirectories") ?? true,
		};
	}

	/**
	 * Gets all valid directories from the searchPath array, with caching
	 */
	static async getValidSearchPaths(): Promise<string[]> {
		const searchParams = this.getSearchParams();
		const searchPaths = searchParams.searchPath;

		// If no paths configured, return empty array (search from root)
		if (!searchPaths || searchPaths.length === 0) {
			return [];
		}

		const validPaths: string[] = [];

		// Check all paths and collect valid ones
		for (const searchPath of searchPaths) {
			if (!searchPath.trim()) {
				continue;
			}

			const expandedPath = this.expandPath(searchPath);
			try {
				if (await this.isDirectoryValid(expandedPath)) {
					validPaths.push(expandedPath);
				}
			} catch (error) {
				// Log but don't throw - continue checking other paths
				console.warn(`rip-open: Invalid search path '${searchPath}': ${error}`);
			}
		}

		if (validPaths.length === 0) {
			console.warn(
				`rip-open: No valid directories found in searchPath: ${searchPaths.join(
					", "
				)}, using root search`
			);
		} else {
			console.log(
				`rip-open: Found ${
					validPaths.length
				} valid search paths: ${validPaths.join(", ")}`
			);
		}

		return validPaths;
	}

	/**
	 * Gets the first valid directory from the searchPath array, with caching
	 * @deprecated Use getValidSearchPaths() for better multi-path support
	 */
	static async getValidSearchPath(): Promise<string> {
		const searchPaths = this.getSearchParams().searchPath;

		// If no paths configured, return empty string (search from root)
		if (!searchPaths || searchPaths.length === 0) {
			return "";
		}
		// Check each path and return the first valid one
		for (const searchPath of searchPaths) {
			if (!searchPath.trim()) {
				continue;
			}

			const expandedPath = this.expandPath(searchPath);
			if (await this.isDirectoryValid(expandedPath)) {
				return expandedPath;
			}
		}

		// No valid paths found
		throw new Error(
			`No valid directories found in searchPath: ${searchPaths.join(", ")}`
		);
	}

	/**
	 * Expands ~ and environment variables in path
	 */
	private static expandPath(inputPath: string): string {
		// Expand ~ to home directory
		if (inputPath.startsWith("~")) {
			const os = require("os");
			return path.join(os.homedir(), inputPath.slice(1));
		}

		// Expand environment variables like $HOME, %USERPROFILE%
		return inputPath
			.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (match, varName) => {
				return process.env[varName] || match;
			})
			.replace(/%([A-Z_][A-Z0-9_]*)%/gi, (match, varName) => {
				return process.env[varName] || match;
			});
	}

	/**
	 * Checks if a directory is valid with caching
	 */
	private static async isDirectoryValid(dirPath: string): Promise<boolean> {
		if (!this._extensionContext) {
			// Fallback if context not set - just run the check
			return this._checkDirectoryExists(dirPath);
		}

		// Check persistent cache first
		const cacheKey = `path-validity-${dirPath}`;
		const cached = this._extensionContext.globalState.get<{
			valid: boolean;
			timestamp: number;
		}>(cacheKey);
		const now = Date.now();

		if (cached && now - cached.timestamp < this.PATH_CACHE_DURATION) {
			return cached.valid;
		}

		// Not cached or expired, check validity
		const isValid = await this._checkDirectoryExists(dirPath);

		// Cache the result
		await this._extensionContext.globalState.update(cacheKey, {
			valid: isValid,
			timestamp: now,
		});

		return isValid;
	}

	/**
	 * Actually checks if directory exists
	 */
	private static async _checkDirectoryExists(
		dirPath: string
	): Promise<boolean> {
		try {
			const stats = await fs.promises.stat(dirPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	static getCacheDuration(): number {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		const minutes = config.get<number>("cacheDurationMinutes") || 5;
		return minutes * 60 * 1000; // Convert to milliseconds
	}

	static isCacheEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("enableCache") ?? true;
	}
	static shouldopenInWindow(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("openInWindow") ?? true;
	}
	static shouldExcludeHomeDotFolders(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("excludeHomeDotFolders") ?? true;
	}
	static getUiDisplayLimit(): number {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<number>("uiDisplayLimit") ?? 100;
	}
	static isBackgroundRefreshEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("enableBackgroundRefresh") ?? true;
	}

	static async resetSettingsToDefault(): Promise<void> {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);

		// Show confirmation dialog
		const choice = await vscode.window.showWarningMessage(
			"Are you sure you want to reset all rip-open settings to their default values?",
			{ modal: true },
			"Reset Settings",
			"Cancel"
		);
		if (choice !== "Reset Settings") {
			return;
		} // Reset all settings to undefined (which restores defaults)
		const settingsToReset = [
			"searchPath",
			"maxDepth",
			"excludePatterns",
			"enableCache",
			"cacheDurationMinutes",
			"enableBackgroundRefresh",
			"openInWindow",
			"excludeHomeDotFolders",
			"uiDisplayLimit",
		];

		try {
			await Promise.all(
				settingsToReset.map((setting) =>
					config.update(setting, undefined, vscode.ConfigurationTarget.Global)
				)
			);
			vscode.window.showInformationMessage(
				"rip-open settings have been reset to default values.",
				{ modal: false }
			);
			setTimeout(() => {
				vscode.commands.executeCommand("workbench.action.closeMessages");
			}, 3000);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to reset settings: ${error}`);
		}
	}
	static getRipgrepPath(): string {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<string>("ripgrepPath") || "auto";
	}

	static getFzfPath(): string {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<string>("fzfPath") || "fzf";
	}

	static isFzfEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("enableFzf") ?? true;
	}
}
