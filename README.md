# Rip Add

Quick directory search and workspace management using [ripgrep](https://github.com/BurntSushi/ripgrep) and [fzf](https://github.com/junegunn/fzf).

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
- Standard VS Code letter highlighting for basic matches.

Large datasets automatically use VS Code's built-in fuzzy matching without quality indicators.

## Requirements

- **ripgrep**: Bundled with VS Code (auto-detected) or install separately.
- **fzf** (optional): Enhanced fuzzy matching and ranking.

## Configuration

### Search Paths
```json
{
    "ripAdd.searchPath": ["C:\\Users\\username", "/home/user/projects"]
}
```

### Performance Tuning
```json
{
    "ripAdd.maxDepth": 10,
    "ripAdd.cacheDurationMinutes": 2,
    "ripAdd.enableBackgroundRefresh": true
}
```

### Tool Paths
```json
{
    "ripAdd.ripgrepPath": "auto",  // auto-detect or specify path
    "ripAdd.fzfPath": "fzf",       // assumes fzf in PATH
    "ripAdd.enableFzf": true
}
```

## Commands

| Command | Default Keybinding | Description |
|---------|-------------------|-------------|
| `Rip Add: Add Directories to Workspace` | `Ctrl+Alt+D` | Search and add to workspace |
| `Rip Add: Open Directory in Current Window` | `Ctrl+Alt+O` | Search and open in current window |
| `Rip Add: Open Directory in New Window` | `Ctrl+Alt+Shift+O` | Search and open in new window |
| `Rip Add: Clear Search Cache` | - | Force cache refresh |

## Performance Notes

- Large datasets (>5000 directories) automatically fallback to basic sorting.
- fzf is called in automatically when the amount of results shrink.
- Background cache refresh maintains responsiveness for subsequent searches.
- Memory and file-based caching optimize repeated searches.