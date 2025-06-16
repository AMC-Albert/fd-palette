// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface DirectoryItem extends vscode.QuickPickItem {
	fullPath: string;
}

interface CacheEntry {
	directories: DirectoryItem[];
	timestamp: number;
	searchParams: string;
	version: number; // For future cache format changes
}

// Simple in-memory cache for current session
const memoryCache = new Map<string, CacheEntry>();

// Extension context for persistent storage
let extensionContext: vscode.ExtensionContext;

// Cache preloading state
let cachePreloadPromise: Promise<void> | null = null;

// File-based cache directory
function getCacheDir(): string {
	const cacheDir = path.join(os.tmpdir(), 'fd-palette-cache');
	if (!fs.existsSync(cacheDir)) {
		fs.mkdirSync(cacheDir, { recursive: true });
	}
	return cacheDir;
}

function getCacheFilePath(cacheKey: string): string {
	const hashedKey = Buffer.from(cacheKey).toString('base64').replace(/[/+=]/g, '_');
	return path.join(getCacheDir(), `${hashedKey}.json`);
}

function getCacheDuration(): number {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const minutes = config.get<number>('cacheDurationMinutes') || 5;
	return minutes * 60 * 1000; // Convert to milliseconds
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('fd-palette extension is now active!');

	// Store context for cache persistence
	extensionContext = context;

	// Clean up old cache files on startup
	cleanupOldCacheFiles();

	// Register the main command
	const disposable = vscode.commands.registerCommand('fd-palette.searchDirectories', async () => {
		await searchAndAddDirectories();
	});

	// Register the fd installation check command
	const checkFdDisposable = vscode.commands.registerCommand('fd-palette.checkFdInstallation', async () => {
		await checkFdInstallation();
	});

	// Register the clear cache command
	const clearCacheDisposable = vscode.commands.registerCommand('fd-palette.clearCache', async () => {
		clearSearchCache();
	});

	context.subscriptions.push(disposable, checkFdDisposable, clearCacheDisposable);

	// Start preloading cache in the background (don't await to avoid blocking activation)
	cachePreloadPromise = preloadCacheInBackground().catch(error => {
		console.warn('Cache preloading failed:', error);
	});
}

function clearSearchCache(): void {
	const memoryCacheSize = memoryCache.size;
	memoryCache.clear();
	
	// Clear VSCode globalState cache
	extensionContext.globalState.keys().forEach(key => {
		if (key.startsWith('fd-palette-cache-')) {
			extensionContext.globalState.update(key, undefined);
		}
	});
	
	// Clear file-based cache
	try {
		const cacheDir = getCacheDir();
		if (fs.existsSync(cacheDir)) {
			const files = fs.readdirSync(cacheDir);
			files.forEach(file => {
				if (file.endsWith('.json')) {
					fs.unlinkSync(path.join(cacheDir, file));
				}
			});
		}
	} catch (error) {
		console.error('Error clearing file cache:', error);
	}
	
	vscode.window.showInformationMessage(`Cleared ${memoryCacheSize} cached search results from memory, disk, and files.`);
}

function getCacheKey(searchPath: string, maxDepth: number, excludePatterns: string[]): string {
	return JSON.stringify({ searchPath, maxDepth, excludePatterns });
}

function getCachedDirectories(cacheKey: string): { directories: DirectoryItem[], source: 'memory' } | null {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const cacheEnabled = config.get<boolean>('enableCache') ?? true;
	
	if (!cacheEnabled) {
		return null;
	}

	// Check memory cache (should contain preloaded data)
	const entry = memoryCache.get(cacheKey);
	
	if (!entry) {
		return null;
	}

	// Check if cache is expired
	if (Date.now() - entry.timestamp > getCacheDuration()) {
		memoryCache.delete(cacheKey);
		// Also clean up from disk
		try {
			const cacheFilePath = getCacheFilePath(cacheKey);
			if (fs.existsSync(cacheFilePath)) {
				fs.unlinkSync(cacheFilePath);
			}
		} catch (error) {
			// Ignore cleanup errors
		}
		return null;
	}

	return { directories: entry.directories, source: 'memory' };
}

async function setCachedDirectories(cacheKey: string, directories: DirectoryItem[]): Promise<void> {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const cacheEnabled = config.get<boolean>('enableCache') ?? true;
	
	if (!cacheEnabled) {
		return;
	}

	const entry: CacheEntry = {
		directories: directories,
		timestamp: Date.now(),
		searchParams: cacheKey,
		version: 1
	};

	// Store in memory cache
	memoryCache.set(cacheKey, entry);
	
	// Store in VSCode globalState
	const diskCacheKey = `fd-palette-cache-${Buffer.from(cacheKey).toString('base64')}`;
	await extensionContext.globalState.update(diskCacheKey, entry);
	
	// Store in file-based cache for persistence across extension reloads
	try {
		const cacheFilePath = getCacheFilePath(cacheKey);
		fs.writeFileSync(cacheFilePath, JSON.stringify(entry), 'utf8');
	} catch (error) {
		console.error('Error writing file cache:', error);
	}
}

async function checkFdInstallation(): Promise<void> {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const fdPath = config.get<string>('fdPath') || 'fd';

	return new Promise((resolve) => {
		const child = spawn(fdPath, ['--version'], {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (code === 0) {
				const version = stdout.trim();
				vscode.window.showInformationMessage(`fd is installed: ${version}`);
			} else {
				vscode.window.showErrorMessage(
					`fd is not installed or not accessible. Please install fd and ensure it's in your PATH. Error: ${stderr}`
				);
			}
			resolve();
		});

		child.on('error', (error) => {
			vscode.window.showErrorMessage(
				`Failed to execute fd: ${error.message}. Please install fd and ensure it's in your PATH.`
			);
			resolve();
		});
	});
}

async function searchAndAddDirectories(): Promise<void> {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const searchPath = config.get<string>('searchPath') || '';
	const maxDepth = config.get<number>('maxDepth') || 5;
	const excludePatterns = config.get<string[]>('excludePatterns') || [];
	const fdPath = config.get<string>('fdPath') || 'fd';

	// Generate cache key
	const cacheKey = getCacheKey(searchPath, maxDepth, excludePatterns);
	
	// Check cache first (should be instant from preloaded memory)
	const cachedResult = getCachedDirectories(cacheKey);
	if (cachedResult) {
		await showDirectoryPicker(cachedResult.directories, cachedResult.source);
		return;
	}

	// If cache preloading is still in progress, wait for it to complete
	if (cachePreloadPromise) {
		try {
			await cachePreloadPromise;
			// Check cache again after preloading completes
			const cachedResultAfterPreload = getCachedDirectories(cacheKey);
			if (cachedResultAfterPreload) {
				await showDirectoryPicker(cachedResultAfterPreload.directories, cachedResultAfterPreload.source);
				return;
			}
		} catch (error) {
			// Preloading failed, continue with normal search
			console.warn('Cache preloading failed, performing fresh search:', error);
		}
	}

	// First check if fd is available
	try {
		await checkFdAvailability(fdPath);
	} catch (error) {
		vscode.window.showErrorMessage(`fd is not available: ${error}`);
		return;
	}

	// Show a progress indicator while searching
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Searching directories with fd...",
		cancellable: true
	}, async (progress, token) => {
		
		try {
			const directories = await findDirectories(fdPath, searchPath, maxDepth, excludePatterns, token);
			
			if (directories.length === 0) {
				vscode.window.showInformationMessage('No directories found.');
				return;
			}

			// Cache the results
			await setCachedDirectories(cacheKey, directories);

			await showDirectoryPicker(directories);

		} catch (error) {
			vscode.window.showErrorMessage(`Error searching directories: ${error}`);
		}
	});
}

async function showDirectoryPicker(directories: DirectoryItem[], cacheSource?: 'memory'): Promise<void> {
	const quickPick = vscode.window.createQuickPick<DirectoryItem>();
	quickPick.items = directories;
	quickPick.canSelectMany = true;
	quickPick.matchOnDescription = true;
	
	// Set up dynamic placeholder
	const updatePlaceholder = () => {
		const searchTerm = quickPick.value.trim();
		const cacheInfo = cacheSource ? ` (${cacheSource} cache)` : '';
		if (searchTerm === '') {
			quickPick.placeholder = `Search ${directories.length} directories${cacheInfo} (type to filter, Enter to add)`;
		} else {
			quickPick.placeholder = `Filtered results${cacheInfo} (Enter to add highlighted, Space for multiple)`;
		}
	};

	// Handle value changes
	quickPick.onDidChangeValue(() => {
		updatePlaceholder();
	});

	// Handle acceptance
	quickPick.onDidAccept(async () => {
		const selectedItems = [...quickPick.selectedItems];
		
		let itemsToAdd: DirectoryItem[] = [];
		
		if (selectedItems.length > 0) {
			// User explicitly selected items (using Space or checkboxes)
			itemsToAdd = selectedItems;
		} else if (quickPick.activeItems.length > 0) {
			// No explicit selection, use the active/highlighted item
			itemsToAdd = [quickPick.activeItems[0]];
		}
		
		if (itemsToAdd.length > 0) {
			try {
				await addDirectoriesToWorkspace(itemsToAdd);
			} catch (error) {
				vscode.window.showErrorMessage(`Error adding directories: ${error}`);
			}
		} else {
			vscode.window.showInformationMessage('No directory selected.');
		}
		
		quickPick.dispose();
	});

	// Handle hiding/cancellation
	quickPick.onDidHide(() => {
		quickPick.dispose();
	});

	// Set initial placeholder and show
	updatePlaceholder();
	quickPick.show();
}

async function checkFdAvailability(fdPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(fdPath, ['--version'], {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		child.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error('fd command failed'));
			}
		});

		child.on('error', (error) => {
			reject(new Error(`Failed to execute fd: ${error.message}. Please install fd and ensure it's in your PATH.`));
		});
	});
}

async function findDirectories(
	fdPath: string, 
	searchPath: string, 
	maxDepth: number, 
	excludePatterns: string[],
	token: vscode.CancellationToken
): Promise<DirectoryItem[]> {
	return new Promise((resolve, reject) => {
		const args: string[] = [
			'--type', 'd', // Only directories
			'--max-depth', maxDepth.toString(),
			'--absolute-path',
			'--color', 'never'
		];

		// Add exclude patterns
		excludePatterns.forEach(pattern => {
			args.push('--exclude', pattern);
		});

		// Add search pattern (empty string to find all directories)
		args.push('.');

		// Add search path if specified
		if (searchPath) {
			args.push(searchPath);
		}

		const child = spawn(fdPath, args, {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (token.isCancellationRequested) {
				resolve([]);
				return;
			}

			if (code !== 0) {
				reject(new Error(`fd command failed with code ${code}: ${stderr}`));
				return;
			}

			const directories = stdout
				.trim()
				.split('\n')
				.filter(line => line.trim() !== '')
				.map(fullPath => {
					const dirName = path.basename(fullPath);
					const parentDir = path.dirname(fullPath);
					
					return {
						label: dirName,
						description: parentDir,
						fullPath: fullPath
					} as DirectoryItem;
				})
				.sort((a, b) => a.label.localeCompare(b.label));

			resolve(directories);
		});

		child.on('error', (error) => {
			reject(new Error(`Failed to spawn fd: ${error.message}. Make sure fd is installed and in PATH.`));
		});

		// Handle cancellation
		token.onCancellationRequested(() => {
			child.kill();
		});
	});
}

async function addDirectoriesToWorkspace(directories: DirectoryItem[]): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	const existingPaths = new Set(workspaceFolders.map(folder => folder.uri.fsPath.toLowerCase()));

	const newFolders: vscode.Uri[] = [];
	
	for (const dir of directories) {
		const normalizedPath = dir.fullPath.toLowerCase();
		if (!existingPaths.has(normalizedPath)) {
			newFolders.push(vscode.Uri.file(dir.fullPath));
		}
	}

	if (newFolders.length === 0) {
		vscode.window.showInformationMessage('All selected directories are already in the workspace.');
		return;
	}

	// Add folders to workspace
	const success = vscode.workspace.updateWorkspaceFolders(
		workspaceFolders.length, // Start index (append to end)
		0, // Delete count
		...newFolders.map(uri => ({ uri }))
	);

	if (success) {
		const folderNames = newFolders.map(uri => path.basename(uri.fsPath)).join(', ');
		vscode.window.showInformationMessage(`Added ${newFolders.length} folder(s) to workspace: ${folderNames}`);
	} else {
		vscode.window.showErrorMessage('Failed to add directories to workspace.');
	}
}

function cleanupOldCacheFiles(): void {
	try {
		const cacheDir = getCacheDir();
		if (!fs.existsSync(cacheDir)) {
			return;
		}

		const files = fs.readdirSync(cacheDir);
		const cacheDuration = getCacheDuration();
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

async function preloadCacheInBackground(): Promise<void> {
	const config = vscode.workspace.getConfiguration('fdPalette');
	const cacheEnabled = config.get<boolean>('enableCache') ?? true;
	
	if (!cacheEnabled) {
		return;
	}

	try {
		// Load all file-based cache entries into memory
		const cacheDir = path.join(extensionContext.globalStorageUri?.fsPath ?? '', 'cache');
		
		if (!fs.existsSync(cacheDir)) {
			return;
		}

		const cacheFiles = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'));
		
		for (const file of cacheFiles) {
			try {
				const filePath = path.join(cacheDir, file);
				const data = fs.readFileSync(filePath, 'utf8');
				const cacheEntry: CacheEntry = JSON.parse(data);
				
				// Check if cache is still valid
				if (Date.now() - cacheEntry.timestamp <= getCacheDuration()) {
					// Extract cache key from filename
					const base64Key = file.replace('.json', '');
					const cacheKey = Buffer.from(base64Key, 'base64').toString('utf8');
					
					// Load into memory cache
					memoryCache.set(cacheKey, cacheEntry);
				} else {
					// Remove expired cache file
					fs.unlinkSync(filePath);
				}
			} catch (error) {
				// Skip invalid cache files
				console.warn(`Failed to load cache file ${file}:`, error);
			}
		}
		
		if (memoryCache.size > 0) {
			console.log(`Preloaded ${memoryCache.size} cache entries into memory`);
		}
	} catch (error) {
		console.warn('Failed to preload cache:', error);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
