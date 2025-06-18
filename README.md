# RipOpen for Visual Studio Code

System-wide directory search and workspace management using [ripgrep](https://github.com/BurntSushi/ripgrep) and [fzf](https://github.com/junegunn/fzf).

## Requirements

- **ripgrep**: Comes bundled with VS Code (auto-detected).
- **fzf** Enhanced fuzzy matching and ranking. Optional but highly reccommended. Ripgrep can find the fzf executable for you in your system if it's not in your PATH.

## Features

- **Fast directory discovery**: Uses ripgrep to find directories across specified search paths.
- **Intelligent caching**: Results cached for 2 minutes with automatic background refresh.
- **Enhanced fuzzy matching**: Optional fzf integration for superior search quality.
- **Multi-path search**: Search across multiple root directories simultaneously.
- **Workspace support**: Open .code-workspace files directly, or extract and add their folder paths to the current workspace.

## Search Interface

When fzf is available and actively filtering, visual indicators show match quality:

- `★` - Excellent fuzzy matches (top 10% of results).
- `•` - Good matches (top 30% of results).
- `·` - Fair matches (top 70% of results).
- `$(git-branch)` - Git repositories (when git repo boost enabled).
- `$(repo)` - .code-workspace files.
- Standard VS Code letter highlighting for basic matches.

Large datasets automatically use VS Code's built-in fuzzy matching without quality indicators.

## Configuration

### Search Paths

```json
{
	"ripOpen.searchPath": ["C:\\Users\\username", "/home/user/projects"]
}
```

### Performance Tuning

```json
{
	"ripOpen.enableCache": true,
	"ripOpen.enableBackgroundRefresh": true,
	"ripOpen.uiDisplayLimit": 100
}
```

### Tool Paths

```json
{
	"ripOpen.ripgrepPath": "auto", // auto-detect or specify path
	"ripOpen.fzfPath": "fzf" // assumes fzf in PATH
}
```

### Advanced Ripgrep Configuration

```json
{
	"ripOpen.additionalRipgrepArgs": [
		"--max-depth=10",
		"--hidden",
		"--no-ignore"
	],
	"ripOpen.boostGitDirectories": true,
	"ripOpen.includeWorkspaceFiles": true
}
```

## Commands

| Command                                          | Default Keybinding | Description                           |
| ------------------------------------------------ | ------------------ | ------------------------------------- |
| `RipOpen: Add Directories to Workspace`          | `Ctrl+Alt+D`       | Search and add to workspace           |
| `RipOpen: Open Directory in Current Window`      | `Ctrl+Alt+O`       | Search and open in current window     |
| `RipOpen: Open Directory in New Window`          | `Ctrl+Alt+Shift+O` | Search and open in new window         |
| `RipOpen: Remove Selected Folder from Workspace` | `Ctrl+Shift+Del`   | Remove selected folder from workspace |
| `RipOpen: Clear Search Cache`                    | -                  | Force cache refresh                   |
| `RipOpen: Reset Settings to Default`             | -                  | Reset all settings to default values  |

## Performance Notes

- Large datasets (>5000 directories) automatically fallback to basic sorting.
- fzf filtering is triggered automatically when search results narrow down.
- Background cache refresh maintains responsiveness for subsequent searches.
- Memory and file-based caching optimize repeated searches.