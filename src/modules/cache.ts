import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { CacheEntry, DirectoryItem, SearchParams } from './types';
import { ConfigurationManager } from './configuration';

export class CacheManager {	private memoryCache = new Map<string, CacheEntry>();
	private isPreloading = false;
	private preloadingPromise: Promise<void> | null = null;
	private cacheDir: string | null = null;
	private fileCacheDisabled = false;

	constructor(private extensionContext: vscode.ExtensionContext) {
		// Initialize cache directory early
		try {
			this.getCacheDir();
		} catch (error) {
			console.warn('fd-palette: Failed to initialize cache directory:', error);
		}
	}	private getCacheDir(): string {
		// Return cached directory if already determined
		if (this.cacheDir) {
			return this.cacheDir;
		}

		try {
			// Use VS Code's extension storage directory instead of temp directory
			// This ensures cache persists across reboots
			const globalStoragePath = this.extensionContext.globalStorageUri.fsPath;
			console.log('fd-palette: Using globalStorage path:', globalStoragePath);
			
			// Ensure the base globalStorage directory exists first
			if (!fs.existsSync(globalStoragePath)) {
				fs.mkdirSync(globalStoragePath, { recursive: true });
				console.log('fd-palette: Created base globalStorage directory:', globalStoragePath);
			}
			
			const cacheDir = path.join(globalStoragePath, 'cache');
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir, { recursive: true });
				console.log('fd-palette: Created cache directory:', cacheDir);
			}
			this.cacheDir = cacheDir;
			return cacheDir;
		} catch (error) {
			// Fallback to temp directory if globalStorage is not available
			console.warn('fd-palette: Could not use globalStorage, falling back to temp directory:', error);
			const fallbackDir = path.join(os.tmpdir(), 'fd-palette-cache');
			if (!fs.existsSync(fallbackDir)) {
				fs.mkdirSync(fallbackDir, { recursive: true });
			}
			this.cacheDir = fallbackDir;
			return fallbackDir;
		}
	}	private getCacheFilePath(cacheKey: string, cacheDir?: string): string {
		// Use SHA256 hash to create a short, predictable filename
		const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
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
			const now = Date.now();

			files.forEach(file => {
				if (file.endsWith('.json')) {
					const filePath = path.join(cacheDir, file);
					try {
						const stats = fs.statSync(filePath);
						const fileContent = fs.readFileSync(filePath, 'utf8');
						const entry = JSON.parse(fileContent) as CacheEntry;
						
						// Remove if expired or invalid version
						if (now - entry.timestamp > cacheDuration || entry.version !== 1) {
							fs.unlinkSync(filePath);
						}
					} catch (error) {
						// If we can't read/parse the file, delete it
						fs.unlinkSync(filePath);
					}
				}
			});
		} catch (error) {
			console.error('Error during cache cleanup:', error);
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
			console.log('fd-palette: Cache is disabled, skipping preload');
			return;
		}

		try {
			let loadedFromGlobalState = 0;
			let loadedFromFiles = 0;

			// Load from VSCode globalState
			const globalStateKeys = this.extensionContext.globalState.keys();
			for (const key of globalStateKeys) {
				if (key.startsWith('fd-palette-cache-')) {
					const entry = this.extensionContext.globalState.get<CacheEntry>(key);
					if (entry && entry.version === 1) {
						this.memoryCache.set(entry.searchParams, entry);
						loadedFromGlobalState++;
					}
				}
			}

			// Load from file cache
			const cacheDir = this.getCacheDir();
			console.log(`fd-palette: Loading file cache from: ${cacheDir}`);
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				console.log(`fd-palette: Found ${files.length} files in cache directory:`, files);
				for (const file of files) {
					if (file.endsWith('.json')) {
						console.log(`fd-palette: Processing cache file: ${file}`);
						try {
							const filePath = path.join(cacheDir, file);
							const fileContent = fs.readFileSync(filePath, 'utf8');
							const entry = JSON.parse(fileContent) as CacheEntry;
							console.log(`fd-palette: Parsed cache entry, version: ${entry?.version}, searchParams length: ${entry?.searchParams?.length}`);
									if (entry && entry.version === 1) {
								// Use the searchParams string as the cache key, same as everywhere else
								const cacheKey = entry.searchParams;
								const cacheKeyHash = crypto.createHash('sha256').update(cacheKey).digest('hex').substring(0, 16);
								console.log(`fd-palette: File cache key hash: ${cacheKeyHash}`);								// Always load from file (file cache is more recent than globalState)
								const existingEntry = this.memoryCache.get(cacheKey);
								if (existingEntry) {
									console.log(`fd-palette: Replacing existing cache entry (age: ${Date.now() - existingEntry.timestamp}ms) with file entry (age: ${Date.now() - entry.timestamp}ms)`);
								}
								this.memoryCache.set(cacheKey, entry);
								loadedFromFiles++;
								console.log(`fd-palette: Loaded cache entry from file, total files loaded: ${loadedFromFiles}`);
							}
						} catch (error) {
							console.log(`fd-palette: Failed to parse cache file ${file}:`, error);
							// Skip invalid files
						}
					}
				}
			}

			console.log(`fd-palette: Cache preloaded - ${loadedFromGlobalState} from globalState, ${loadedFromFiles} from files, ${this.memoryCache.size} total entries`);
		} catch (error) {
			console.error('Error preloading cache:', error);
		}
	}	getCachedDirectories(searchParams: SearchParams): DirectoryItem[] | null {
		if (!ConfigurationManager.isCacheEnabled()) {
			return null;
		}
		const cacheKey = this.getCacheKey(searchParams);
		const cacheKeyHash = crypto.createHash('sha256').update(cacheKey).digest('hex').substring(0, 16);
		
		// Reduced cache debug logging - only when debug is enabled
		if (ConfigurationManager.isDebugEnabled()) {
			console.log('fd-palette: Cache lookup key hash:', cacheKeyHash);
			console.log('fd-palette: Memory cache has', this.memoryCache.size, 'entries');
		}
		
		// Debug: show all cache keys in memory
		const memoryCacheKeys = Array.from(this.memoryCache.keys()).map(key => 
			crypto.createHash('sha256').update(key).digest('hex').substring(0, 16)
		);
		console.log('fd-palette: Memory cache key hashes:', memoryCacheKeys);
		
		// Debug: Check for exact key match
		const hasExactKey = this.memoryCache.has(cacheKey);
		console.log('fd-palette: Exact key exists in cache:', hasExactKey);
		
		// Debug: Find matching key by hash
		const matchingKey = Array.from(this.memoryCache.keys()).find(key => 
			crypto.createHash('sha256').update(key).digest('hex').substring(0, 16) === cacheKeyHash
		);
		
		if (matchingKey && matchingKey !== cacheKey) {
			console.log('fd-palette: Found matching hash but different key string!');
			console.log('fd-palette: Current key length:', cacheKey.length);
			console.log('fd-palette: Matching key length:', matchingKey.length);
			console.log('fd-palette: Keys are identical:', cacheKey === matchingKey);
			
			// Use the matching key instead
			const entry = this.memoryCache.get(matchingKey);
			if (entry) {
				console.log('fd-palette: Using matched entry from cache');
				// Check if cache is expired
				if (Date.now() - entry.timestamp > ConfigurationManager.getCacheDuration()) {
					console.log('fd-palette: Cache entry expired, removing');
					this.memoryCache.delete(matchingKey);
					return null;
				}
				return entry.directories;
			}
		}
				const entry = this.memoryCache.get(cacheKey);
		console.log('fd-palette: Cache get result:', entry ? 'found' : 'null/undefined');
		console.log('fd-palette: Entry type:', typeof entry);
		
		if (!entry) {
			console.log('fd-palette: Cache entry not found in memory despite has() returning true!');
			console.log('fd-palette: This is a critical bug - investigating...');
			
			// Try to find the entry by iterating
			for (const [key, value] of this.memoryCache.entries()) {
				const keyHash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
				if (keyHash === cacheKeyHash) {
					console.log('fd-palette: Found entry by iteration! Key comparison:', key === cacheKey);
					console.log('fd-palette: Key lengths - current:', cacheKey.length, 'found:', key.length);
					
					// Check if cache is expired
					if (Date.now() - value.timestamp > ConfigurationManager.getCacheDuration()) {
						console.log('fd-palette: Cache entry expired, removing');
						this.memoryCache.delete(key);
						return null;
					}
					
					console.log('fd-palette: Using found entry from iteration');
					return value.directories;
				}
			}
			
			return null;		}
		
		// Check if cache is expired
		const now = Date.now();
		const cacheAge = now - entry.timestamp;
		const cacheDuration = ConfigurationManager.getCacheDuration();
		const isExpired = cacheAge > cacheDuration;
		
		console.log('fd-palette: Cache expiration check - age:', cacheAge, 'duration:', cacheDuration, 'expired:', isExpired);
		
		if (isExpired) {
			console.log('fd-palette: Cache entry expired, removing from all storage');
			this.memoryCache.delete(cacheKey);
			const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
			const diskCacheKey = `fd-palette-cache-${hash.substring(0, 16)}`;
			this.extensionContext.globalState.update(diskCacheKey, undefined);
			try {
				const cacheFilePath = this.getCacheFilePath(cacheKey);
				if (fs.existsSync(cacheFilePath)) {
					fs.unlinkSync(cacheFilePath);
				}			} catch (error) {
				console.error('Error removing expired file cache:', error);
			}
			return null;
		}

		console.log('fd-palette: Cache hit! Returning', entry.directories.length, 'directories');
		return entry.directories;
	}

	async setCachedDirectories(searchParams: SearchParams, directories: DirectoryItem[]): Promise<void> {
		if (!ConfigurationManager.isCacheEnabled()) {
			return;
		}

		const cacheKey = this.getCacheKey(searchParams);
		const entry: CacheEntry = {
			directories: directories,
			timestamp: Date.now(),
			searchParams: cacheKey,
			version: 1
		};
		// Store in memory cache
		this.memoryCache.set(cacheKey, entry);
		
		// Store in VSCode globalState only for smaller datasets (globalState is slow for large data)
		const MAX_GLOBALSTATE_ENTRIES = 1000;
		const useGlobalState = directories.length <= MAX_GLOBALSTATE_ENTRIES;
				if (useGlobalState) {
			const globalStateStartTime = Date.now();
			const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
			const diskCacheKey = `fd-palette-cache-${hash.substring(0, 16)}`;
			await this.extensionContext.globalState.update(diskCacheKey, entry);
			console.log(`fd-palette: GlobalState cache took ${Date.now() - globalStateStartTime}ms for ${directories.length} entries`);
		} else {
			console.log(`fd-palette: Skipping globalState cache for large dataset (${directories.length} entries), using file cache only`);		}// Store in file-based cache for persistence across extension reloads
		if (!this.fileCacheDisabled) {
			// Get fresh cache directory path and ensure it exists
			const cacheDir = this.getCacheDir();
			console.log('fd-palette: About to write cache file, cacheDir:', cacheDir);
			
			try {
				// Triple-check that the directory exists before getting the file path
				if (!fs.existsSync(cacheDir)) {
					console.log('fd-palette: Cache directory missing, recreating:', cacheDir);
					fs.mkdirSync(cacheDir, { recursive: true });
					console.log('fd-palette: Directory created successfully');
				}
				
				// Verify directory exists after creation attempt
				if (!fs.existsSync(cacheDir)) {
					throw new Error(`Failed to create cache directory: ${cacheDir}`);
				}				const cacheFilePath = this.getCacheFilePath(cacheKey, cacheDir);
				console.log('fd-palette: Writing to cache file:', cacheFilePath);
				console.log('fd-palette: Cache file path length:', cacheFilePath.length);
				
				// Ensure parent directory of cache file exists (should be same as cacheDir)
				const parentDir = path.dirname(cacheFilePath);
				if (!fs.existsSync(parentDir)) {
					console.log('fd-palette: Parent directory missing, creating:', parentDir);
					fs.mkdirSync(parentDir, { recursive: true });
				}
				
				// Additional diagnostic: check if the path is too long (Windows limitation)
				if (process.platform === 'win32' && cacheFilePath.length > 260) {
					console.warn(`fd-palette: Cache file path may be too long for Windows (${cacheFilePath.length} chars): ${cacheFilePath}`);
				}
				
				fs.writeFileSync(cacheFilePath, JSON.stringify(entry), 'utf8');
				console.log('fd-palette: Successfully wrote cache file:', cacheFilePath);
			} catch (error: any) {
				console.error('Error writing file cache:', error);
				console.error('fd-palette: Error details - code:', error.code, 'message:', error.message);
				console.error('fd-palette: Cache directory exists:', fs.existsSync(cacheDir));
				console.error('fd-palette: Attempted file path:', this.getCacheFilePath(cacheKey, cacheDir));
				console.warn('fd-palette: Disabling file cache due to persistent errors. Memory and globalState cache will continue to work.');
				this.fileCacheDisabled = true;
			}
		}
	}

	clearCache(): void {
		const memoryCacheSize = this.memoryCache.size;
		this.memoryCache.clear();
		
		// Clear VSCode globalState cache
		this.extensionContext.globalState.keys().forEach(key => {
			if (key.startsWith('fd-palette-cache-')) {
				this.extensionContext.globalState.update(key, undefined);
			}
		});
		
		// Clear file-based cache
		try {
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				files.forEach(file => {
					if (file.endsWith('.json')) {
						fs.unlinkSync(path.join(cacheDir, file));
					}
				});
			}		} catch (error) {
			console.error('Error clearing file cache:', error);
		}

		vscode.window.showInformationMessage(`Cache cleared. Removed ${memoryCacheSize} entries.`);
	}

	// Debug method to show cache status
	getCacheStatus(): { memoryEntries: number; diskEntries: number; fileEntries: number } {
		const memoryEntries = this.memoryCache.size;
		
		// Count VS Code globalState entries
		const diskEntries = this.extensionContext.globalState.keys()
			.filter(key => key.startsWith('fd-palette-cache-')).length;
		
		// Count file entries
		let fileEntries = 0;
		try {
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				fileEntries = files.filter(file => file.endsWith('.json')).length;
			}
		} catch (error) {
			console.error('Error counting file cache entries:', error);
		}

		return { memoryEntries, diskEntries, fileEntries };
	}
}
