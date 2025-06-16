import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { DirectoryItem, SearchParams } from './types';
import { ConfigurationManager } from './configuration';

export class DirectorySearcher {
	private static readonly FD_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
	private static _extensionContext: vscode.ExtensionContext | undefined;

	static setExtensionContext(context: vscode.ExtensionContext): void {
		this._extensionContext = context;
	}
	static async checkFdAvailability(fdPath: string): Promise<void> {
		console.log(`fd-palette: checkFdAvailability called with fdPath: ${fdPath}`);
		console.log(`fd-palette: Extension context available: ${!!this._extensionContext}`);
		
		if (!this._extensionContext) {
			// Fallback if context not set - just run the check
			console.log('fd-palette: No extension context, running uncached check');
			return this._runFdAvailabilityCheck(fdPath);
		}

		// Check persistent cache first
		const cacheKey = `fd-availability-${fdPath}`;
		console.log(`fd-palette: Checking cache for key: ${cacheKey}`);
		const cached = this._extensionContext.globalState.get<{ available: boolean; timestamp: number }>(cacheKey);
		const now = Date.now();
		
		console.log(`fd-palette: Cached entry:`, cached);
		if (cached && (now - cached.timestamp) < this.FD_CACHE_DURATION) {
			console.log(`fd-palette: fd availability check cached (${cached.available ? 'available' : 'unavailable'})`);
			if (cached.available) {
				return Promise.resolve();
			} else {
				return Promise.reject(new Error('fd command failed (cached result)'));
			}
		}

		// Not cached or expired, check availability
		try {
			await this._runFdAvailabilityCheck(fdPath);
			// Cache the success
			await this._extensionContext.globalState.update(cacheKey, { available: true, timestamp: now });
		} catch (error) {
			// Cache the failure
			await this._extensionContext.globalState.update(cacheKey, { available: false, timestamp: now });
			throw error;
		}
	}
	private static async _runFdAvailabilityCheck(fdPath: string): Promise<void> {
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

	static async checkFdInstallation(fdPath: string): Promise<void> {
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

	static async findDirectories(
		searchParams: SearchParams,
		token: vscode.CancellationToken
	): Promise<DirectoryItem[]> {
		const { fdPath, searchPath, maxDepth, excludePatterns } = searchParams;

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

				const processingStartTime = Date.now();
				
				// Step 1: Split and filter lines
				const splitStartTime = Date.now();
				const rawLines = stdout
					.trim()
					.split('\n')
					.filter(line => line.trim() !== '');
				console.log(`fd-palette: Line splitting took ${Date.now() - splitStartTime}ms for ${rawLines.length} lines`);

				// Step 2: Map to DirectoryItem objects
				const mappingStartTime = Date.now();
				const mappedDirectories = rawLines.map(fullPath => {
					const dirName = path.basename(fullPath);
					const parentDir = path.dirname(fullPath);
					
					return {
						label: dirName,
						description: parentDir,
						fullPath: fullPath
					} as DirectoryItem;
				});
				console.log(`fd-palette: Directory mapping took ${Date.now() - mappingStartTime}ms`);

				// Step 3: Sort directories
				const sortStartTime = Date.now();
				const directories = mappedDirectories.sort((a, b) => a.label.localeCompare(b.label));
				console.log(`fd-palette: Directory sorting took ${Date.now() - sortStartTime}ms`);

				const totalProcessingTime = Date.now() - processingStartTime;
				console.log(`fd-palette: Total directory processing took ${totalProcessingTime}ms`);

				resolve(directories);
			});

			child.on('error', (error) => {
				reject(new Error(`Failed to spawn fd: ${error.message}. Make sure fd is installed and in PATH.`));
			});

			// Handle cancellation
			token.onCancellationRequested(() => {
				child.kill();
			});
		});	}
}
