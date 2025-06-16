import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CacheEntry, DirectoryItem, SearchParams } from './types';
import { ConfigurationManager } from './configuration';

export class CacheManager {
	private memoryCache = new Map<string, CacheEntry>();
	private isPreloading = false;
	private preloadingPromise: Promise<void> | null = null;

	constructor(private extensionContext: vscode.ExtensionContext) {}

	private getCacheDir(): string {
		const cacheDir = path.join(os.tmpdir(), 'fd-palette-cache');
		if (!fs.existsSync(cacheDir)) {
			fs.mkdirSync(cacheDir, { recursive: true });
		}
		return cacheDir;
	}

	private getCacheFilePath(cacheKey: string): string {
		const hashedKey = Buffer.from(cacheKey).toString('base64').replace(/[/+=]/g, '_');
		return path.join(this.getCacheDir(), `${hashedKey}.json`);
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
			return;
		}

		try {
			// Load from VSCode globalState
			const globalStateKeys = this.extensionContext.globalState.keys();
			for (const key of globalStateKeys) {
				if (key.startsWith('fd-palette-cache-')) {
					const entry = this.extensionContext.globalState.get<CacheEntry>(key);
					if (entry && entry.version === 1) {
						this.memoryCache.set(entry.searchParams, entry);
					}
				}
			}

			// Load from file cache
			const cacheDir = this.getCacheDir();
			if (fs.existsSync(cacheDir)) {
				const files = fs.readdirSync(cacheDir);
				for (const file of files) {
					if (file.endsWith('.json')) {
						try {
							const filePath = path.join(cacheDir, file);
							const fileContent = fs.readFileSync(filePath, 'utf8');
							const entry = JSON.parse(fileContent) as CacheEntry;
							
							if (entry && entry.version === 1) {
								this.memoryCache.set(entry.searchParams, entry);
							}
						} catch (error) {
							// Skip invalid files
						}
					}
				}
			}
		} catch (error) {
			console.error('Error preloading cache:', error);
		}
	}

	getCachedDirectories(searchParams: SearchParams): DirectoryItem[] | null {
		if (!ConfigurationManager.isCacheEnabled()) {
			return null;
		}

		const cacheKey = this.getCacheKey(searchParams);
		const entry = this.memoryCache.get(cacheKey);
		
		if (!entry) {
			return null;
		}

		// Check if cache is expired
		if (Date.now() - entry.timestamp > ConfigurationManager.getCacheDuration()) {
			this.memoryCache.delete(cacheKey);
			const diskCacheKey = `fd-palette-cache-${Buffer.from(cacheKey).toString('base64')}`;
			this.extensionContext.globalState.update(diskCacheKey, undefined);
			try {
				const cacheFilePath = this.getCacheFilePath(cacheKey);
				if (fs.existsSync(cacheFilePath)) {
					fs.unlinkSync(cacheFilePath);
				}
			} catch (error) {
				console.error('Error removing expired file cache:', error);
			}
			return null;
		}

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
		
		// Store in VSCode globalState
		const diskCacheKey = `fd-palette-cache-${Buffer.from(cacheKey).toString('base64')}`;
		await this.extensionContext.globalState.update(diskCacheKey, entry);
		
		// Store in file-based cache for persistence across extension reloads
		try {
			const cacheFilePath = this.getCacheFilePath(cacheKey);
			fs.writeFileSync(cacheFilePath, JSON.stringify(entry), 'utf8');
		} catch (error) {
			console.error('Error writing file cache:', error);
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
	}
}
