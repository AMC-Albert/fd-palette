import * as assert from "assert";
import * as vscode from "vscode";

suite("rip-open Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		const extension = vscode.extensions.getExtension(
			"undefined_publisher.rip-open"
		);
		assert.ok(extension);
	});
	test("Commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("rip-open.addToWorkspace"));
		assert.ok(commands.includes("rip-open.openInWindow"));
		assert.ok(commands.includes("rip-open.clearCache"));
		assert.ok(commands.includes("rip-open.resetSettings"));
	});
});
