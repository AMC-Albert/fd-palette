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
			fdPath: config.get<string>('fdPath') || 'fd',
			fzfPath: config.get<string>('fzfPath') || 'fzf',
			enableFzf: config.get<boolean>('enableFzf') ?? true,
			fzfOptions: config.get<string>('fzfOptions') || '--height=60% --layout=reverse --border --info=inline --cycle'
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
	static shouldopenInWindow(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>('openInWindow') ?? true;
	}
	static shouldExcludeHomeDotFolders(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>('excludeHomeDotFolders') ?? true;
	}
	static getUiDisplayLimit(): number {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<number>('uiDisplayLimit') ?? 100;
	}

	static getFzfPath(): string {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<string>('fzfPath') || 'fzf';
	}

	static isFzfEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>('enableFzf') ?? true;
	}

	static isDebugEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		return config.get<boolean>('enableDebugLogging') ?? false;
	}

	static async resetSettingsToDefault(): Promise<void> {
		const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
		
		// Show confirmation dialog
		const choice = await vscode.window.showWarningMessage(
			'Are you sure you want to reset all fd-palette settings to their default values?',
			{ modal: true },
			'Reset Settings',
			'Cancel'
		);

		if (choice !== 'Reset Settings') {
			return;
		}		// Reset all settings to undefined (which restores defaults)
		const settingsToReset = [
			'searchPath',
			'maxDepth',
			'excludePatterns',
			'fdPath',
			'fzfPath',
			'enableFzf',
			'fzfOptions',
			'enableCache',
			'cacheDurationMinutes',
			'openInWindow',
			'excludeHomeDotFolders',
			'uiDisplayLimit',
			'enableDebugLogging'
		];

		try {
			await Promise.all(
				settingsToReset.map(setting => 
					config.update(setting, undefined, vscode.ConfigurationTarget.Global)
				)
			);

			vscode.window.showInformationMessage('fd-palette settings have been reset to default values.');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to reset settings: ${error}`);
		}
	}
}
