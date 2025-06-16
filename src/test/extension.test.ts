import * as assert from 'assert';
import * as vscode from 'vscode';

suite('fd-palette Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.fd-palette');
		assert.ok(extension);
	});

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('fd-palette.searchDirectories'));
		assert.ok(commands.includes('fd-palette.checkFdInstallation'));
	});
});
