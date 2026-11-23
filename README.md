# The Omniscience — Tauri

This is the standalone Tauri 2 project. The Node.js sidecar is part of the
project.

## Run

Requirements: Node.js, Rust, and the platform build tools required by Tauri.

```powershell
npm install
npm run tauri -- dev
```

The Tauri command rebuilds local app assets, serves the Tauri frontend from
`dist`, and then launches the app. Opening the frontend alone does not provide
the Tauri or Node.js APIs.

The app builds the copied web assets, starts a persistent Node.js sidecar,
and creates three separate workspace windows: a full-screen desktop, a top
panel, and a window-control pad at the left edge. On Windows the 28-pixel panel
shows **Menu**, windows hidden from the taskbar, the clock, and search, settings,
development, and power controls. Selecting a window brings it forward;
middle-click closes it. Menu opens a separate overview window, leaving the panel
at a fixed size. Closing any of the three workspace windows exits the whole
workspace.

The overview lists programs found in the local `componentapps`,
and `webapps` directories. On Windows it also lists
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
open the existing `create-item` and `rename` componentapps in frameless Tauri
windows. Creation and rename refuse to replace existing entries.
The **Appearance** section makes Omni Theme a built-in Tauri feature and
applies its existing color-processing engine to the shell and program windows.

## Current scope

This migration slice validates the three-window Tauri shell, Node bridge,
program catalog, filesystem workflows, built-in theme, desktop file grid, and
standalone webapp windows with basic lifecycle controls. The desktop grid does
not yet have native file icons, media previews, or context-menu/drag
integrations. A customizable desktop window layout, Windows desktop
integration, extension runtime, and app-specific Electron IPC are still future
work. Componentapps other than `create-item`, `rename`, and `windows-settings`,
and extensions are shown in the catalog but are not yet launchable. The
file-dialog componentapps support only the file operations needed by those
dialogs.
