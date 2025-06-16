import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { DirectoryItem, SearchParams } from './types';

export class DirectorySearcher {
	static async checkFdAvailability(fdPath: string): Promise<void> {
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
}
