import * as assert from "assert";
import * as vscode from "vscode";

suite("rip-add Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		const extension = vscode.extensions.getExtension(
			"undefined_publisher.rip-add"
		);
		assert.ok(extension);
	});
	test("Commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);		assert.ok(commands.includes("rip-add.addToWorkspace"));
		assert.ok(commands.includes("rip-add.openInWindow"));
		assert.ok(commands.includes("rip-add.clearCache"));
		assert.ok(commands.includes("rip-add.resetSettings"));
	});
});
