# The Omniscience — Tauri

This is the standalone Tauri 2 project. The Node.js sidecar is part of the
project.

## Run

Requirements: Node.js, Rust, and the platform build tools required by Tauri.

```powershell
npm install
npm start
npm run tauri -- dev
```

The Tauri command rebuilds local app assets, serves the Tauri frontend from
`dist`, and then launches the app. Opening the frontend alone does not provide
the Tauri or Node.js APIs.

`npm run tauri -- dev` selects an available loopback port for the preview
server and configures Tauri to use that same port. To create a standalone
Windows executable, run `npm run build`; the resulting
`src-tauri/target/release/The_Omniscience.exe` includes the Node.js sidecar and
its runtime files. On first launch, the sidecar is extracted under the app's
local AppData directory. WebView2 remains a Windows system requirement.

The app builds the copied web assets, starts a persistent Node.js sidecar,
and creates three separate workspace windows: a full-screen desktop, a top
panel, and a window-control pad at the left edge. On Windows the 28-pixel panel
shows **Menu**, windows hidden from the taskbar, the clock, and search, settings,
development, and power controls. Selecting a window brings it forward;
middle-click closes it. Menu opens a separate overview window, leaving the panel
at a fixed size. Closing any of the three workspace windows exits the whole
workspace.

The overview lists programs found in the local `componentapps` and `webapps`
directories. Componentapps are collected from both `componentapps` and
`legacy/componentapps`; files in the current directory override files of the
same name from `legacy`, while legacy-only apps and resources remain available.
`Index.tsx`, `Index.ts`, `Index.jsx`, and `Index.js` can be used as frontend
entrypoints when an app does not provide `index.html`. On Windows it also lists
Start Menu shortcuts and installed UWP apps, which launch through Explorer or
the Windows activation API.
Standalone webapps open in separate Tauri windows.
The sidecar communicates with the Rust host over newline-delimited JSON on stdin
and stdout and serves built webapp files from a loopback-only HTTP server.
The overview's **Open windows** section lets you bring program windows forward,
minimize them, or close them. The separate window-control pad uses the original
5-by-3 cross: its center moves the active window, surrounding cells resize it,
and the right column maximizes, minimizes, or closes it. It can also focus,
minimize, maximize, or close native windows hidden from the taskbar; moving,
resizing, and settings for native windows are not yet migrated. The
window-settings panel can change the layer of Tauri app windows, reload them, and
open their developer tools. The **Windows Settings** component app opens the
same Control Panel categories as the Electron version. Opacity controls are not
yet migrated. On Windows, **Hidden processes** lists native windows omitted from
the taskbar and can focus or close them.
The desktop window lists the user's Desktop directory and supports folder
navigation, file/folder creation, renaming, and opening files through the OS.
The **Files** section provides directory navigation, listing, folder/file
creation, and rename operations through the same Node.js sidecar. It can also
open componentapps with the supported frontend entrypoints in frameless Tauri
windows. Creation and rename refuse to replace existing entries.
The **Appearance** section configures the bundled `omni-theme` extension. Its
Manifest V3 content scripts apply the existing color-processing engine to the
shell and matching program windows.

## Chromium extensions

Manifest V3 extensions placed in `extensions/<extension-id>` are discovered
at startup; restart the app after adding or changing one. The app injects
matching `content_scripts` through its document-created preload and schedules
them according to `run_at`. The app also supports its own top-level
`omniscience` manifest object: `preloads` has `matches`, `css`, and `js` (no
`run_at`; it runs immediately at preload), while `targets` enables application
areas. Target defaults are `webapps: true`, `componentapps: true`,
`extensions: false`, `shell: false`, and `devtools: false`. `omni-theme`
enables all targets and uses `omniscience.preloads`.

The app exposes a small `chrome.runtime` API and persistent
`chrome.storage.local` get/set/remove/clear operations. Extensions with
`action.default_popup` appear in the application catalog and open their popup
in a separate Tauri window.

This is a hand-built compatibility layer, not a full Chromium extension host.
Background/service workers, isolated execution worlds, `chrome.tabs`,
`chrome.scripting`, permissions, and most other Chromium APIs are not
implemented. Content scripts currently execute in the page's main world.

## Componentapp backends

A componentapp can provide `backend.rs` to register a native Tauri backend.
The module is compiled into the host and must export:

```rust
pub fn invoke(
    method: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String>
```

The frontend calls it through the compatibility API
`window.electron_componentapp_API.invoke(channel, ...args)`. The method name is
passed as `channel`, and the arguments are passed to Rust as a JSON array.
Without a Rust backend, the compatibility bridge also preserves the existing
file IPC used by Chonky and Monaco. Existing JavaScript and JSX application
files do not need to be changed to use the catalog or frontend-entrypoint
support.

## Current scope

This migration slice validates the three-window Tauri shell, Node bridge,
program catalog, filesystem workflows, the extension-based theme, basic
Manifest V3 content scripts and action popups, desktop file grid, and
standalone webapp windows with basic lifecycle controls. Other app-specific
legacy Electron IPC handlers still require a Tauri backend before their
IPC-dependent features can work. The desktop grid does
not yet have native file icons, media previews, or context-menu/drag
integrations. A customizable desktop window layout, Windows desktop
integration, broader Chromium API compatibility, and app-specific Electron IPC
are still future work. Componentapps other than `create-item`, `rename`, and
`windows-settings` are shown in the catalog but are not yet launchable. The
file-dialog componentapps support only the file operations needed by those
dialogs.
