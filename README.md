# fd Palette

A VSCode extension that leverages the `fd` command-line tool to search for directories system-wide and easily add them to your workspace.

## Features

- **System-wide directory search**: Search for directories across your entire system using the fast `fd` tool
- **Quick Pick interface**: Select multiple directories using VSCode's built-in QuickPick interface
- **Configurable search**: Customize search depth, exclude patterns, and search paths
- **Workspace integration**: Automatically add selected directories to your current workspace

### Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run the command "Search Directories with fd"
3. Browse through the found directories
4. Select one or more directories (use `Ctrl+Click` for multiple selection)
5. Press Enter to add them to your workspace

## Requirements

This extension requires the `fd` command-line tool to be installed on your system:

- **Windows**: `winget install sharkdp.fd` or `choco install fd`
- **macOS**: `brew install fd`
- **Linux**: `sudo apt install fd-find` (Ubuntu/Debian) or package manager equivalent

## Extension Settings

This extension contributes the following settings:

* `fdPalette.searchPath`: Default search path for fd (leave empty to search from root)
* `fdPalette.maxDepth`: Maximum search depth for fd (default: 5)
* `fdPalette.excludePatterns`: Patterns to exclude from search (default includes common build/cache directories)
* `fdPalette.fdPath`: Path to fd executable (default: "fd", assumes it's in PATH)

## Configuration Example

```json
{
    "fdPalette.searchPath": "/home/user/projects",
    "fdPalette.maxDepth": 3,
    "fdPalette.excludePatterns": [
        "node_modules",
        ".git",
        ".vscode",
        "target",
        "build",
        "dist"
    ],
    "fdPalette.fdPath": "fd"
}
```

## Known Issues

- The extension requires `fd` to be installed and accessible in your system PATH
- Very large directory trees may take some time to search
- On Windows, ensure `fd` is properly installed and accessible

## Release Notes

### 0.0.1

Initial release of fd Palette:
- Basic directory search functionality with fd
- QuickPick interface for directory selection
- Workspace integration
- Configurable search parameters

---

## Development

To contribute to this extension:

1. Clone the repository
2. Run `pnpm install` to install dependencies
3. Press `F5` to start debugging the extension in a new Extension Development Host window
4. Make your changes and test them
5. Submit a pull request

For more information about developing VSCode extensions, see the [Extension API documentation](https://code.visualstudio.com/api).

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
