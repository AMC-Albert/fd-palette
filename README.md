# Rip Open for Visual Studio Code

System-wide directory search and workspace management using [ripgrep](https://github.com/BurntSushi/ripgrep) and [fzf](https://github.com/junegunn/fzf).

## Features

- **Fast directory discovery**: Uses ripgrep to find directories across specified search paths.
- **Intelligent caching**: Results cached for 2 minutes with automatic background refresh.
- **Enhanced fuzzy matching**: Optional fzf integration for superior search quality.
- **Multi-path search**: Search across multiple root directories simultaneously.
- **Workspace integration**: Add directories to workspace or open in new window.

## Search Interface

When fzf is available and actively filtering, visual indicators show match quality:

- `★` - Excellent fuzzy matches (top 10% of results).
- `•` - Good matches (top 30% of results).
- `·` - Fair matches (top 70% of results).
- `$(git-branch)` - Git repositories (when git repo boost enabled).
- Standard VS Code letter highlighting for basic matches.

Large datasets automatically use VS Code's built-in fuzzy matching without quality indicators.

## Requirements

- **ripgrep**: Bundled with VS Code (auto-detected) or install separately.
- **fzf** (optional): Enhanced fuzzy matching and ranking.

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
    "ripOpen.maxDepth": 10,
    "ripOpen.cacheDurationMinutes": 2,
    "ripOpen.enableBackgroundRefresh": true
}
```

### Tool Paths
```json
{
    "ripOpen.ripgrepPath": "auto",  // auto-detect or specify path
    "ripOpen.fzfPath": "fzf",       // assumes fzf in PATH
    "ripOpen.enableFzf": true
}
```

### Advanced Ripgrep Configuration
```json
{
    "ripOpen.includeHidden": true,      // Include hidden files/directories
    "ripOpen.respectGitignore": false,  // Respect .gitignore and ignore files
    "ripOpen.additionalRipgrepArgs": ["--follow", "--case-sensitive"]
}
```

## Commands

| Command                                           | Default Keybinding | Description                           |
| ------------------------------------------------- | ------------------ | ------------------------------------- |
| `Rip Open: Add Directories to Workspace`          | `Ctrl+Alt+D`       | Search and add to workspace           |
| `Rip Open: Open Directory in Current Window`      | `Ctrl+Alt+O`       | Search and open in current window     |
| `Rip Open: Open Directory in New Window`          | `Ctrl+Alt+Shift+O` | Search and open in new window         |
| `Rip Open: Remove Selected Folder from Workspace` | `Ctrl+Shift+Del`   | Remove selected folder from workspace |
| `Rip Open: Clear Search Cache`                    | -                  | Force cache refresh                   |

## Performance Notes

- Large datasets (>5000 directories) automatically fallback to basic sorting.
- fzf is called in automatically when the amount of results shrink.
- Background cache refresh maintains responsiveness for subsequent searches.
- Memory and file-based caching optimize repeated searches.