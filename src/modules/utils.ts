import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export class PathUtils {
	/**
	 * Attempts to find VS Code's bundled ripgrep executable
	 * Supports multiple VS Code variants: Stable, Insiders, Exploration, VSCodium, Cursor
	 * Checks various installation methods: standard, portable, Microsoft Store, Snap, Flatpak, Homebrew, AppImage
	 */
	static getBundledRipgrepPath(): string | null {
		try {
			// Try to get VS Code's installation path
			const homeDir = os.homedir();
			const isWindows = process.platform === "win32";
			const isMac = process.platform === "darwin";
			const isLinux = process.platform === "linux";

			const possiblePaths = [
				// Windows paths
				...(isWindows
					? [
							// VS Code Stable
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Microsoft VS Code",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VS Code Insiders
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Microsoft VS Code Insiders",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VS Code Exploration (Canary)
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Microsoft VS Code Exploration",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VSCodium
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"VSCodium",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// Cursor Editor
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Programs",
								"Cursor",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VS Code from Microsoft Store
							path.join(
								homeDir,
								"AppData",
								"Local",
								"Microsoft",
								"WindowsApps",
								"Microsoft.VisualStudioCode_8wekyb3d8bbwe",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// VS Code Portable
							path.join(
								process.env.VSCODE_PORTABLE || "",
								"resources",
								"app",
								"node_modules",
								"@vscode",
								"ripgrep",
								"bin",
								"rg.exe"
							),
							// System-wide installations
							"C:\\Program Files\\Microsoft VS Code\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
							"C:\\Program Files (x86)\\Microsoft VS Code\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
							"C:\\Program Files\\VSCodium\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe",
					  ]
					: []),

				// macOS paths
				...(isMac
					? [
							// VS Code Stable
							"/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VS Code Insiders
							"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VS Code Exploration
							"/Applications/Visual Studio Code - Exploration.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VSCodium
							"/Applications/VSCodium.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Cursor Editor
							"/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Homebrew installations
							"/opt/homebrew/Cellar/visual-studio-code/*/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/usr/local/Cellar/visual-studio-code/*/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
					  ]
					: []),

				// Linux paths
				...(isLinux
					? [
							// Standard installations
							"/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/opt/visual-studio-code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// VSCodium
							"/usr/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/opt/vscodium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Snap installations
							"/snap/code/current/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							"/snap/codium/current/usr/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							// Flatpak installations
							path.join(
								homeDir,
								".local/share/flatpak/app/com.visualstudio.code/current/active/files/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							path.join(
								homeDir,
								".local/share/flatpak/app/com.vscodium.codium/current/active/files/share/codium/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							// AppImage installations (common locations)
							path.join(
								homeDir,
								".local/bin/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							path.join(
								homeDir,
								"Applications/code/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
							// Cursor Editor
							"/opt/cursor/resources/app/node_modules/@vscode/ripgrep/bin/rg",
							path.join(
								homeDir,
								".local/share/cursor/resources/app/node_modules/@vscode/ripgrep/bin/rg"
							),
					  ]
					: []),
			];

			for (const rgPath of possiblePaths) {
				if (fs.existsSync(rgPath)) {
					console.log(`rip-open: Found bundled ripgrep at: ${rgPath}`);
					return rgPath;
				}
			}

			console.log("rip-open: No bundled ripgrep found in common locations");
			return null;
		} catch (error) {
			console.warn("rip-open: Error detecting bundled ripgrep:", error);
			return null;
		}
	}
}
