import * as assert from "assert";
import * as vscode from "vscode";

suite("rip-scope Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("Extension should be present", () => {
		const extension = vscode.extensions.getExtension(
			"undefined_publisher.rip-scope"
		);
		assert.ok(extension);
	});
	test("Commands should be registered", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("rip-scope.addToWorkspace"));
		assert.ok(commands.includes("rip-scope.openInWindow"));
		assert.ok(commands.includes("rip-scope.clearCache"));
		assert.ok(commands.includes("rip-scope.resetSettings"));
	});
});
