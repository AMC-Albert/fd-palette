import * as vscode from 'vscode';
import { SearchParams } from './types';

export class ConfigurationManager {
	private static readonly CONFIG_SECTION = 'fdPalette';

	static getSearchParams(): SearchParams {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return {
			searchPath: config.get<string>('searchPath') || '',
			maxDepth: config.get<number>('maxDepth') || 5,
			excludePatterns: config.get<string[]>('excludePatterns') || [],
			fdPath: config.get<string>('fdPath') || 'fd'
		};
	}

	static getCacheDuration(): number {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		const minutes = config.get<number>('cacheDurationMinutes') || 5;
		return minutes * 60 * 1000; // Convert to milliseconds
	}

	static isCacheEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>('enableCache') ?? true;
	}
}
