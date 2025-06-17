import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { CacheEntry, DirectoryItem, SearchParams } from "./types";
import { ConfigurationManager } from "./configuration";

export class CacheManager {
	private memoryCache = new Map<string, CacheEntry>();
	private isPreloading = false;
	private preloadingPromise: Promise<void> | null = null;
	private cacheDir: string | null = null;
	private fileCacheDisabled = false;
	// Background refresh tracking
	private backgroundRefreshes = new Map<string, Promise<void>>();
	private refreshDebounceTimers = new Map<string, NodeJS.Timeout>();

	// Git repository cache for performance optimization
	private gitRepoCache = new Map<string, boolean>();
	private gitCacheTimestamp = 0;
	private readonly GIT_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

	constructor(private extensionContext: vscode.ExtensionContext) {
		// Initialize cache directory early
		try {
			this.getCacheDir();
		} catch (error) {
			console.warn("rip-open: Failed to initialize cache directory:", error);
		}
	}
	private getCacheDir(): string {
		// Return cached directory if already determined
		if (this.cacheDir) {
			return this.cacheDir;
		}

		try {
			// Use VS Code's extension storage directory instead of temp directory
			// This ensures cache persists across reboots
			const globalStoragePath = this.extensionContext.globalStorageUri.fsPath;

			// Ensure the base globalStorage directory exists first
			if (!fs.existsSync(globalStoragePath)) {
				fs.mkdirSync(globalStoragePath, { recursive: true });
			}

			const cacheDir = path.join(globalStoragePath, "cache");
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir, { recursive: true });
			}
			this.cacheDir = cacheDir;
			return cacheDir;
		} catch (error) {
			// Fallback to temp directory if globalStorage is not available
			console.warn(
				"rip-open: Could not use globalStorage, falling back to temp directory:",
				error
			);
			const fallbackDir = path.join(os.tmpdir(), "rip-open-cache");
			if (!fs.existsSync(fallbackDir)) {
				fs.mkdirSync(fallbackDir, { recursive: true });
			}
			this.cacheDir = fallbackDir;
			return fallbackDir;
		}
	}
	private getCacheFilePath(cacheKey: string, cacheDir?: string): string {
		// Use SHA256 hash to create a short, predictable filename
		const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
		const basePath = cacheDir || this.getCacheDir();
		return path.join(basePath, `cache_${hash.substring(0, 16)}.json`);
	}

	private getCacheKey(searchParams: SearchParams): string {
		const { searchPath, maxDepth, excludePatterns } = searchParams;
		return JSON.stringify({ searchPath, maxDepth, excludePatterns });
	}
	cleanupOldCacheFiles(): void {
		try {
			const cacheDir = this.getCacheDir();
			if (!fs.existsSync(cacheDir)) {
				return;
			}

			const files = fs.readdirSync(cacheDir);
			const cacheDuration = ConfigurationManager.getCacheDuration();
			const maxAge = cacheDuration * 10; // Only cleanup cache 10x older than normal duration
			const now = Date.now();

			files.forEach((file) => {
				if (file.endsWith(".json")) {
					const filePath = path.join(cacheDir, file);
					try {
						const stats = fs.statSync(filePath);
						const fileContent = fs.readFileSync(filePath, "utf8");
						const entry = JSON.parse(fileContent) as CacheEntry;

						// Remove if very old or invalid version
						if (now - entry.timestamp > maxAge || entry.version !== 1) {
							fs.unlinkSync(filePath);
						}
					} catch (error) {
						// If we can't read/parse the file, delete it
						fs.unlinkSync(filePath);
					}
				}
			});
		} catch (error) {
			console.error("Error during cache cleanup:", error);
		}
	}

	async preloadCacheInBackground(): Promise<void> {
		if (this.isPreloading || this.preloadingPromise) {
			return this.preloadingPromise || Promise.resolve();
		}

		this.isPreloading = true;
		this.preloadingPromise = this.doPreloadCache();

		try {
			await this.preloadingPromise;
		} finally {
			this.isPreloading = false;
			this.preloadingPromise = null;
		}
	}
	private async doPreloadCache(): Promise<void> {
		if (!ConfigurationManager.isCacheEnabled()) {
			return;
		}

		try {
			let loadedFromGlobalState = 0;
			let loadedFromFiles = 0;

			// Load from VSCode globalState
			const globalStateKeys = this.extensionContext.globalState.keys();
			for (const key of globalStateKeys) {
				if (key.startsWith("rip-open-cache-")) {
					const entry = this.extensionContext.globalState.get<CacheEntry>(key);
					if (entry && entry.version === 1) {
						this.memoryCache.set(entry.searchParams, entry);
						loadedFromGlobalState++;
					}
				}
			} // Load from file cache
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				for (const file of files) {
					if (file.endsWith(".json")) {
						try {
							const filePath = path.join(cacheDir, file);
							const fileContent = fs.readFileSync(filePath, "utf8");
							const entry = JSON.parse(fileContent) as CacheEntry;
							if (entry && entry.version === 1) {
								// Use the searchParams string as the cache key, same as everywhere else
								const cacheKey = entry.searchParams;
								// Always load from file (file cache is more recent than globalState)
								this.memoryCache.set(cacheKey, entry);
								loadedFromFiles++;
							}
						} catch (error) {
							// Skip invalid files - file may be corrupted or incomplete
						}
					}
				}
			}
		} catch (error) {
			console.error("Error preloading cache:", error);
		}
	}
	getCachedDirectories(searchParams: SearchParams): DirectoryItem[] | null {
		if (!ConfigurationManager.isCacheEnabled()) {
			// Cache disabled, returning null
			return null;
		}

		const cacheKey = this.getCacheKey(searchParams);
		const entry = this.memoryCache.get(cacheKey);
		if (!entry) {
			// Cache MISS - no entry found
			return null;
		}

		// Check if cache is expired
		const age = Date.now() - entry.timestamp;
		const maxAge = ConfigurationManager.getCacheDuration();
		const isExpired = age > maxAge;
		if (isExpired) {
			// Cache EXPIRED - using stale cache, will refresh in background
		} else {
			// Cache HIT - returning directories from memory cache
		}

		return entry.directories;
	}
	/**
	 * Get cached directories with automatic background refresh for expired cache.
	 * Returns cached data immediately if available, and automatically triggers
	 * background refresh if cache is expired.
	 */
	getCachedDirectoriesWithRefresh(
		searchParams: SearchParams,
		triggerBackgroundRefresh: boolean = false
	): DirectoryItem[] | null {
		const cachedDirectories = this.getCachedDirectories(searchParams);

		if (
			cachedDirectories &&
			triggerBackgroundRefresh &&
			ConfigurationManager.isBackgroundRefreshEnabled()
		) {
			// Automatically refresh if cache is expired
			if (this.shouldRefreshInBackground(searchParams)) {
				console.log("rip-open: Cache expired - triggering background refresh");
				this.triggerBackgroundRefresh(searchParams);
			}
		}

		return cachedDirectories;
	}
	/**
	 * Determines if cache should be refreshed in background
	 * Now simply checks if cache is expired
	 */
	private shouldRefreshInBackground(searchParams: SearchParams): boolean {
		const cacheKey = this.getCacheKey(searchParams);

		// Don't refresh if already refreshing
		if (this.backgroundRefreshes.has(cacheKey)) {
			return false;
		}

		const entry = this.memoryCache.get(cacheKey);
		if (!entry) {
			return false;
		}

		// Refresh if cache is expired (age > cache duration)
		const age = Date.now() - entry.timestamp;
		const maxAge = ConfigurationManager.getCacheDuration();

		return age > maxAge;
	}

	/**
	 * Triggers a background refresh of the cache for given search parameters
	 */
	private triggerBackgroundRefresh(searchParams: SearchParams): void {
		const cacheKey = this.getCacheKey(searchParams);

		// Debounce multiple refresh requests
		if (this.refreshDebounceTimers.has(cacheKey)) {
			clearTimeout(this.refreshDebounceTimers.get(cacheKey)!);
		}

		const timer = setTimeout(() => {
			this.refreshDebounceTimers.delete(cacheKey);
			this.performBackgroundRefresh(searchParams);
		}, 500); // 500ms debounce

		this.refreshDebounceTimers.set(cacheKey, timer);
	}

	/**
	 * Performs the actual background refresh
	 */
	private async performBackgroundRefresh(
		searchParams: SearchParams
	): Promise<void> {
		const cacheKey = this.getCacheKey(searchParams);

		// Prevent multiple simultaneous refreshes for the same key
		if (this.backgroundRefreshes.has(cacheKey)) {
			return;
		}

		console.log(
			"rip-open: Starting background cache refresh for:",
			cacheKey.substring(0, 50) + "..."
		);

		const refreshPromise = this.doBackgroundRefresh(searchParams);
		this.backgroundRefreshes.set(cacheKey, refreshPromise);

		try {
			await refreshPromise; // Background cache refresh completed successfully
		} catch (error) {
			console.error("rip-open: Background cache refresh failed:", error);
		} finally {
			this.backgroundRefreshes.delete(cacheKey);
		}
	}

	/**
	 * The actual background refresh logic - imports DirectorySearcher dynamically to avoid circular deps
	 */
	private async doBackgroundRefresh(searchParams: SearchParams): Promise<void> {
		try {
			// Dynamically import to avoid circular dependency
			const { DirectorySearcher } = await import("./directory-search.js");

			// Check if ripgrep is available
			const rgPath = await DirectorySearcher.checkRipgrepAvailability();

			// Check if fzf is available and enabled
			let useFzf = false;
			if (searchParams.enableFzf) {
				try {
					await DirectorySearcher.checkFzfAvailability(searchParams.fzfPath);
					useFzf = true;
				} catch (error) {
					// Fzf not available, use basic ripgrep
					useFzf = false;
				}
			}

			// Create a cancellation token for the background search
			const tokenSource = new vscode.CancellationTokenSource();

			// Set a timeout to cancel if it takes too long (don't block forever in background)
			const timeout = setTimeout(() => {
				tokenSource.cancel();
			}, 30000); // 30 second timeout for background refresh

			try {
				// Use ripgrep with or without fzf
				const directories = useFzf
					? await DirectorySearcher.findDirectoriesWithFzf(
							searchParams,
							tokenSource.token
					  )
					: await DirectorySearcher.findDirectories(
							searchParams,
							tokenSource.token
					  );

				// Update cache with new results
				await this.setCachedDirectories(searchParams, directories);

				const searchMethod = useFzf ? "ripgrep + fzf" : "ripgrep";
				console.log(
					`rip-open: Background refresh completed using ${searchMethod} - cached ${directories.length} directories`
				);
			} finally {
				clearTimeout(timeout);
				tokenSource.dispose();
			}
		} catch (error) {
			// Don't throw - background refresh failures shouldn't affect the user
			console.warn("rip-open: Background refresh failed:", error);
		}
	}

	async setCachedDirectories(
		searchParams: SearchParams,
		directories: DirectoryItem[]
	): Promise<void> {
		if (!ConfigurationManager.isCacheEnabled()) {
			return;
		}

		const cacheKey = this.getCacheKey(searchParams);
		const entry: CacheEntry = {
			directories: directories,
			timestamp: Date.now(),
			searchParams: cacheKey,
			version: 1,
		};
		// Store in memory cache
		this.memoryCache.set(cacheKey, entry);

		// Store in VSCode globalState only for smaller datasets (globalState is slow for large data)
		const MAX_GLOBALSTATE_ENTRIES = 1000;
		const useGlobalState = directories.length <= MAX_GLOBALSTATE_ENTRIES;
		if (useGlobalState) {
			const globalStateStartTime = Date.now();
			const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
			const diskCacheKey = `rip-open-cache-${hash.substring(0, 16)}`;
			await this.extensionContext.globalState.update(diskCacheKey, entry);
			console.log(
				`rip-open: GlobalState cache took ${
					Date.now() - globalStateStartTime
				}ms for ${directories.length} entries`
			);
		} else {
			console.log(
				`rip-open: Skipping globalState cache for large dataset (${directories.length} entries), using file cache only`
			);
		} // Store in file-based cache for persistence across extension reloads
		if (!this.fileCacheDisabled) {
			// Get fresh cache directory path and ensure it exists
			const cacheDir = this.getCacheDir();
			console.log("rip-open: About to write cache file, cacheDir:", cacheDir);

			try {
				// Triple-check that the directory exists before getting the file path
				if (!fs.existsSync(cacheDir)) {
					console.log(
						"rip-open: Cache directory missing, recreating:",
						cacheDir
					);
					fs.mkdirSync(cacheDir, { recursive: true });
					console.log("rip-open: Directory created successfully");
				}

				// Verify directory exists after creation attempt
				if (!fs.existsSync(cacheDir)) {
					throw new Error(`Failed to create cache directory: ${cacheDir}`);
				}
				const cacheFilePath = this.getCacheFilePath(cacheKey, cacheDir);
				console.log("rip-open: Writing to cache file:", cacheFilePath);
				console.log("rip-open: Cache file path length:", cacheFilePath.length);

				// Ensure parent directory of cache file exists (should be same as cacheDir)
				const parentDir = path.dirname(cacheFilePath);
				if (!fs.existsSync(parentDir)) {
					console.log(
						"rip-open: Parent directory missing, creating:",
						parentDir
					);
					fs.mkdirSync(parentDir, { recursive: true });
				}

				// Additional diagnostic: check if the path is too long (Windows limitation)
				if (process.platform === "win32" && cacheFilePath.length > 260) {
					console.warn(
						`rip-open: Cache file path may be too long for Windows (${cacheFilePath.length} chars): ${cacheFilePath}`
					);
				}

				fs.writeFileSync(cacheFilePath, JSON.stringify(entry), "utf8");
				console.log("rip-open: Successfully wrote cache file:", cacheFilePath);
			} catch (error: any) {
				console.error("Error writing file cache:", error);
				console.error(
					"rip-open: Error details - code:",
					error.code,
					"message:",
					error.message
				);
				console.error(
					"rip-open: Cache directory exists:",
					fs.existsSync(cacheDir)
				);
				console.error(
					"rip-open: Attempted file path:",
					this.getCacheFilePath(cacheKey, cacheDir)
				);
				console.warn(
					"rip-open: Disabling file cache due to persistent errors. Memory and globalState cache will continue to work."
				);
				this.fileCacheDisabled = true;
			}
		}
	}

	clearCache(): void {
		const memoryCacheSize = this.memoryCache.size;
		this.memoryCache.clear();

		// Clear VSCode globalState cache
		this.extensionContext.globalState.keys().forEach((key) => {
			if (key.startsWith("rip-open-cache-")) {
				this.extensionContext.globalState.update(key, undefined);
			}
		});

		// Clear file-based cache
		try {
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				files.forEach((file) => {
					if (file.endsWith(".json")) {
						fs.unlinkSync(path.join(cacheDir, file));
					}
				});
			}
		} catch (error) {
			console.error("Error clearing file cache:", error);
		}
		vscode.window.showInformationMessage(
			`Cache cleared. Removed ${memoryCacheSize} entries.`,
			{ modal: false }
		);
		setTimeout(() => {
			vscode.commands.executeCommand("workbench.action.closeMessages");
		}, 2500);
	}

	// Debug method to show cache status
	getCacheStatus(): {
		memoryEntries: number;
		diskEntries: number;
		fileEntries: number;
	} {
		const memoryEntries = this.memoryCache.size;

		// Count VS Code globalState entries
		const diskEntries = this.extensionContext.globalState
			.keys()
			.filter((key) => key.startsWith("rip-open-cache-")).length;

		// Count file entries
		let fileEntries = 0;
		try {
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				fileEntries = files.filter((file) => file.endsWith(".json")).length;
			}
		} catch (error) {
			console.error("Error counting file cache entries:", error);
		}

		return { memoryEntries, diskEntries, fileEntries };
	}

	/**
	 * Cleanup method to clear any pending background refresh timers
	 */
	dispose(): void {
		// Clear all debounce timers
		for (const timer of this.refreshDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.refreshDebounceTimers.clear();

		// Note: We don't cancel ongoing background refreshes as they should complete on their own
		console.log(
			"rip-open: CacheManager disposed, cleared all pending refresh timers"
		);
	}

	/**
	 * Check if a directory is a git repository (with caching)
	 */
	isGitRepository(dirPath: string): boolean {
		// Check if cache is still valid
		const now = Date.now();
		if (now - this.gitCacheTimestamp > this.GIT_CACHE_DURATION) {
			// Cache expired, clear it
			this.gitRepoCache.clear();
			this.gitCacheTimestamp = now;
		}

		// Check cache first
		if (this.gitRepoCache.has(dirPath)) {
			return this.gitRepoCache.get(dirPath)!;
		}

		// Check filesystem and cache result
		try {
			const gitPath = path.join(dirPath, ".git");
			const isGitRepo = fs.existsSync(gitPath);
			this.gitRepoCache.set(dirPath, isGitRepo);
			return isGitRepo;
		} catch (error) {
			// Cache negative result for failed checks
			this.gitRepoCache.set(dirPath, false);
			return false;
		}
	}

	/**
	 * Batch check git repositories for multiple directories (async for better performance)
	 */
	async batchCheckGitRepositories(
		directories: DirectoryItem[]
	): Promise<Map<string, boolean>> {
		const results = new Map<string, boolean>();

		// Process in batches to avoid overwhelming the filesystem
		const BATCH_SIZE = 50;
		for (let i = 0; i < directories.length; i += BATCH_SIZE) {
			const batch = directories.slice(i, i + BATCH_SIZE);

			// Process batch
			for (const dir of batch) {
				results.set(dir.fullPath, this.isGitRepository(dir.fullPath));
			}

			// Small delay between batches to avoid blocking the UI
			if (i + BATCH_SIZE < directories.length) {
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		}

		return results;
	}

	/**
	 * Clear git repository cache
	 */
	clearGitCache(): void {
		this.gitRepoCache.clear();
		this.gitCacheTimestamp = 0;
	}
}
