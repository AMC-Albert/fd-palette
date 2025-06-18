import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SearchParams } from "./types";
import { MessageUtils } from "./utils";

export class ConfigurationManager {
	private static readonly CONFIG_SECTION = "ripScope";
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
			excludePatterns: config.get<string[]>("excludePatterns") || [],
			ripgrepPath: config.get<string>("ripgrepPath") || "auto",
			fzfPath: config.get<string>("fzfPath") || "fzf",
			fzfOptions:
				config.get<string>("fzfOptions") ||
				"--scheme=path --tiebreak=pathname,length --smart-case",
			fzfFilterArgs:
				config.get<string>("fzfFilterArgs") ||
				"--algo=v1 --tiebreak=length --no-info --no-scrollbar",
			fzfRankingArgs:
				config.get<string>("fzfRankingArgs") ||
				"--print0 --read0 --no-info --no-scrollbar",
			additionalRipgrepArgs: config.get<string[]>("additionalRipgrepArgs") || [
				"--max-depth=10",
				"--hidden",
				"--no-ignore",
			],
			boostGitRepos: config.get<boolean>("boostGitRepos") ?? true,
			includeWorkspaceFiles:
				config.get<boolean>("includeWorkspaceFiles") ?? true,
		};
	}

	/**
	 * Gets all valid directories from the searchPath array, with caching
	 */
	static async getValidSearchPaths(): Promise<string[]> {
		const searchParams = this.getSearchParams();
		const searchPaths = searchParams.searchPath;

		// If no paths configured, return empty array (search from home directory)
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
				console.warn(
					`rip-scope: Invalid search path '${searchPath}': ${error}`
				);
			}
		}

		if (validPaths.length === 0) {
			console.warn(
				`rip-scope: No valid directories found in searchPath: ${searchPaths.join(
					", "
				)}, using home directory search`
			);
		} else {
			console.log(
				`rip-scope: Found ${
					validPaths.length
				} valid search paths: ${validPaths.join(", ")}`
			);
		}

		return validPaths;
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
	static isCacheEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>("enableCache") ?? true;
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
		const choice = await MessageUtils.showWithActions(
			"warning",
			"Are you sure you want to reset all rip-scope settings to their default values?",
			"Reset Settings",
			"Cancel"
		);
		if (choice !== "Reset Settings") {
			return;
		} // Reset all settings to undefined (which restores defaults)
		const settingsToReset = [
			"searchPath",
			"excludePatterns",
			"ripgrepPath",
			"fzfPath",
			"fzfOptions",
			"enableCache",
			"enableBackgroundRefresh",
			"uiDisplayLimit",
			"boostGitRepos",
			"includeWorkspaceFiles",
			"additionalRipgrepArgs",
			"fzfFilterArgs",
			"fzfRankingArgs",
		];

		try {
			await Promise.all(
				settingsToReset.map((setting) =>
					config.update(setting, undefined, vscode.ConfigurationTarget.Global)
				)
			);
			await MessageUtils.showInfo(
				"rip-scope settings have been reset to default values."
			);
			setTimeout(() => {
				vscode.commands.executeCommand("workbench.action.closeMessages");
			}, 3000);
		} catch (error) {
			await MessageUtils.showError(`Failed to reset settings: ${error}`);
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
