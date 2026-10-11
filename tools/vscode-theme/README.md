# REDnode HUD

A dark VS Code color theme in the [REDnode](https://github.com/CyberbuildsAI/REDnode) house style: near-black HUD panels, yellow for focus and active elements, cyan for links and types. Syntax colors match the code blocks on the [REDnode docs site](https://cyberbuildsai.github.io/REDnode/).

It covers the workbench, editor, terminal, diffs, Git decorations and syntax highlighting, including semantic highlighting for TypeScript, C++ and other languages with a language server.

## Install

The theme is not on the Marketplace yet. Install the `.vsix` package:

1. Build it from the repo root with `npm run theme:package`, or download it from a release. The file is `dist/rednode-hud-theme-<version>.vsix`.
2. In VS Code, open the Extensions view, click **...** at the top, choose **Install from VSIX...** and pick the file.
   From a terminal: `code --install-extension dist/rednode-hud-theme-0.1.0.vsix`
3. Press **Ctrl+K Ctrl+T** and choose **REDnode HUD**.

Uninstall it from the Extensions view like any other extension.

## Fonts

A theme cannot set fonts. To match the docs site, install [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) and add to your settings:

```json
"editor.fontFamily": "'JetBrains Mono', Consolas, monospace",
"terminal.integrated.fontFamily": "'JetBrains Mono', Consolas, monospace"
```

## Colors

| Role | Color |
|---|---|
| Background | `#08090d` |
| Panels | `#10131b` |
| Lines and borders | `#262c3d` |
| Text | `#e3e6ee` |
| Muted text | `#8a93a8` |
| Focus, keywords, active | `#fcee0a` |
| Links, functions, types | `#19f3ff` |
| Strings, additions | `#5dffa1` |
| Errors, deletions | `#ff2a52` |
| Properties | `#ff9ad5` |
| Numbers, constants | `#ffb86b` |

## License

MIT
