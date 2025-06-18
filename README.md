# RipScope for Visual Studio Code

System-wide directory search and workspace management using [ripgrep](https://github.com/BurntSushi/ripgrep) and [fzf](https://github.com/junegunn/fzf).

## Requirements

- **ripgrep**: Comes bundled with VS Code (auto-detected).
- **fzf** Enhanced fuzzy matching and ranking. Optional but highly reccommended. Ripgrep can find the fzf executable for you in your system if it's not in your PATH.

## Features

- **Unified directory search workflow**: Single command with post-selection action prompts for streamlined usage
- **Fast directory discovery**: Uses ripgrep to find directories across specified search paths.
- **Intelligent caching**: Results cached for 2 minutes with automatic background refresh.
- **Enhanced fuzzy matching**: Optional fzf integration for superior search quality.
- **Multi-path search**: Search across multiple root directories simultaneously.
- **Context-aware actions**: Action options adapt based on single vs. multiple directory selection.
- **Workspace management**:
  - Add directories to workspace or replace entire workspace with new selections.
  - Open .code-workspace files directly, or extract and add their folder paths to the current workspace.

## Search Interface

When fzf is available and actively filtering, visual indicators show match quality:

- `★` - Excellent fuzzy matches (top 10% of results).
- `•` - Good matches (top 30% of results).
- `·` - Fair matches (top 70% of results).
- `$(git-branch)` - Git repositories (when git repo boost enabled).
- `$(repo)` - .code-workspace files.
- Standard VS Code letter highlighting for basic matches.

Large datasets automatically use VS Code's built-in fuzzy matching without quality indicators.

The **Search Directories** command (`Ctrl+Alt+S`) provides a streamlined workflow:

1. **Search and Select**: Use the directory picker to find and select one or more folders
2. **Choose Action**: After selection, choose what to do with your folders from context-aware options

### Custom Keybindings

Most commands don't have default keybindings to avoid conflicts. You can assign your own keybindings through VS Code's Keyboard Shortcuts settings (`Ctrl+K Ctrl+S`) or by adding them to your `keybindings.json`:

```json
{
  "key": "ctrl+alt+d",
  "command": "rip-scope.addToWorkspace"
}
```

## Configuration

### Search Paths

```json
{
	"ripScope.searchPath": ["C:\\Users\\username", "/home/user/projects"]
}
```

### Performance Tuning

```json
{
	"ripScope.enableCache": true,
	"ripScope.enableBackgroundRefresh": true,
	"ripScope.uiDisplayLimit": 100
}
```

### Tool Paths

```json
{
	"ripScope.ripgrepPath": "auto", // auto-detect or specify path
	"ripScope.fzfPath": "fzf" // assumes fzf in PATH
}
```

### Advanced Ripgrep Configuration

```json
{
	"ripScope.additionalRipgrepArgs": [
		"--max-depth=10",
		"--hidden",
		"--no-ignore"
	],
	"ripScope.boostGitRepos": true,
	"ripScope.includeWorkspaceFiles": true
}
```

## Commands

### Primary Command (Recommended)

| Command                        | Default Keybinding | Description                                             |
| ------------------------------ | ------------------ | ------------------------------------------------------- |
| `ripScope: Search Directories` | `Ctrl+Alt+S`       | **Unified search** - select folders, then choose action |

After selecting directories, you'll be prompted to choose from context-aware actions:

- **Add to Workspace** - Add selected folders to current workspace
- **Replace Workspace** - Replace entire workspace with selected folders
- **Open in Current Window** - Replace current workspace and open folders
- **Open in New Window** - Open folders in new VS Code window
- **Create Folder** _(single selection only)_ - Create new folder inside selected directory
- **Delete** - Permanently delete selected folders or workspace files

### Direct Action Commands

| Command                                  | Default Keybinding | Description                                        |
| ---------------------------------------- | ------------------ | -------------------------------------------------- |
| `ripScope: Add Directories to Workspace` | -                  | Search and add to workspace                        |
| `ripScope: Replace Workspace`            | -                  | Search and replace entire workspace                |
| `ripScope: Create Folder`                | -                  | Search and create new folder                       |
| `ripScope: Open Folder`                  | -                  | Search and open folder (prompts for window choice) |

### Workspace Management Commands

| Command                                           | Default Keybinding | Description                                    |
| ------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `ripScope: Remove Selected Folder from Workspace` | `Ctrl+Shift+Del`   | Remove selected folder from workspace          |
| `ripScope: Replace Workspace with Parent Folder`  | -                  | Replace workspace with parent folder           |
| `ripScope: Open Parent Folder`                    | -                  | Open parent folder (prompts for window choice) |
| `ripScope: Close and Delete Workspace`            | -                  | Close workspace and delete the workspace file  |

### Utility Commands

| Command                               | Default Keybinding | Description                          |
| ------------------------------------- | ------------------ | ------------------------------------ |
| `ripScope: Clear Search Cache`        | -                  | Force cache refresh                  |
| `ripScope: Reset Settings to Default` | -                  | Reset all settings to default values |

## Performance Notes

- Large datasets (>5000 directories) automatically fallback to basic sorting.
- fzf filtering is triggered automatically when search results narrow down.
- Background cache refresh maintains responsiveness for subsequent searches.
- Memory and file-based caching optimize repeated searches.
