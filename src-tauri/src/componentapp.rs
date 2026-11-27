use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};
use tauri::{AppHandle, State, WebviewWindow};

use crate::{
    node::{NodeBridge, call_node},
    theme::window_chrome_initialization_script,
};

pub(crate) fn component_app_init_script(
    app_id: &str,
    params: &Value,
    theme_settings: &Value,
    is_windows_settings: bool,
) -> Result<String, String> {
    let app_id = serde_json::to_string(app_id)
        .map_err(|error| format!("Could not encode componentapp id: {error}"))?;
    let params = serde_json::to_string(params)
        .map_err(|error| format!("Could not encode componentapp parameters: {error}"))?;
    let theme_script = window_chrome_initialization_script(theme_settings, "componentapps")?;
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let script = r#"
(() => {
  window.__OMNI_COMPONENTAPP_ID__ = __OMNI_APP_ID__;
  window.__OMNI_INITIAL_PARAMS__ = __OMNI_PARAMS__;
  const invoke = (method, payload) => window.__TAURI__.core.invoke("node_request", { method, payload });
  const componentInvoke = (channel, ...args) =>
    window.__TAURI__.core.invoke("componentapp_request", {
      appId: __OMNI_APP_ID__,
      method: channel,
      payload: args,
    });
  const operation = async (method, payload) => {
    try {
      return { success: true, ...(await invoke(method, payload)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message.includes("EEXIST") ? "EEXIST" : message };
    }
  };
  const desktopListeners = new Map();
  const emitDesktop = (channel, payload) => {
    for (const listener of desktopListeners.get(channel) || []) listener(payload);
  };
  const readDir = async (directory) => {
    try {
      const result = await invoke("list-directory", { path: directory });
      return {
        success: true,
        files: result.entries.map((entry) => ({
          id: entry.path,
          name: entry.name,
          displayName: entry.name,
          isDir: entry.kind === "directory",
          mediaKind: null,
          fileUrl: null,
          iconPath: null,
          infoTip: null,
          size: entry.size,
          modifiedAt: entry.modifiedAt,
        })),
        directoryMetadata: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        files: [],
        directoryMetadata: null,
        error: message.includes("ENOENT") || message.includes("not found")
          ? "permission_denied"
          : message,
      };
    }
  };
  const watchedDirectories = new Map();
  __OMNI_COMPONENTAPP_API__
  window.electron_desktop_API = {
    platform: "__OMNI_PLATFORM__",
    getProjectRoot: () => invoke("health", {}).then((result) => result.projectRoot),
    getUserDirs: () => invoke("get-user-dirs", {}),
    getAppsList: () => invoke("get-apps-list", {}),
    closeWindow: () => window.__TAURI__.window.getCurrentWindow().close(),
    invoke: (channel, ...args) => componentInvoke(channel, ...args),
    readDir,
    openPath: (path) => invoke("open-path", { path }),
    openWith: (path) => invoke("open-with", { path }),
    revealPath: (path) => invoke("reveal-path", { path }),
    copyFiles: (paths) => invoke("copy-files", { paths }),
    cutFiles: (paths) => invoke("cut-files", { paths }),
    pasteFiles: (dir) => invoke("paste-files", { dir }),
    dropPaths: (paths, dir, isMove = false) => invoke("drop-paths", { paths, dir, isMove }),
    writeDroppedFiles: (files, dir) => invoke("write-dropped-files", { files, dir }),
    startDrag: (paths) => window.__TAURI__.core.invoke("start_file_drag", { paths }),
    getCutPaths: () => invoke("get-cut-paths", {}),
    clearCut: () => invoke("clear-cut", {}),
    deletePath: (path) => invoke("delete-path", { path }),
    showContextMenu: (options) => window.__TAURI__.core.invoke("show_desktop_context_menu", options),
    getFileIcon: async (path) => {
      const icons = await window.__TAURI__.core.invoke("get_file_icons", { paths: [path] });
      const fileUrl = icons[path] || null;
      return { success: Boolean(fileUrl), fileUrl };
    },
    getFileIcons: (paths) => window.__TAURI__.core.invoke("get_file_icons", { paths }),
    watchStart: (path) => {
      if (watchedDirectories.has(path)) return;
      const timer = window.setInterval(async () => {
        try {
          await invoke("list-directory", { path });
          emitDesktop("fs:did-change", { dir: path });
        } catch (error) {
          console.error("[componentapp] directory watch failed:", error);
        }
      }, 1500);
      watchedDirectories.set(path, timer);
    },
    watchStop: (path) => {
      const timer = watchedDirectories.get(path);
      if (timer !== undefined) window.clearInterval(timer);
      watchedDirectories.delete(path);
    },
    on: (channel, listener) => {
      const listeners = desktopListeners.get(channel) || new Set();
      listeners.add(listener);
      desktopListeners.set(channel, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) desktopListeners.delete(channel);
      };
    },
    send: (channel, payload) => {
      if (channel === "theme:enabled-changed") return;
      console.error(`[componentapp] unsupported desktop event: ${channel}`, payload);
    },
    createFolder: (dir, name) => operation("create-folder", { parentPath: dir, name }),
    createFile: (dir, name) => operation("create-file", { parentPath: dir, name }),
    renamePath: (path, name) => operation("rename-path", { path, name }),
  };
  window.__TAURI__.event.listen("desktop-context-menu-action", ({ payload }) => {
    emitDesktop("desktop-context-menu-action", payload);
  }).catch((error) => console.error("[desktop] context menu event listener failed:", error));
  window.__TAURI__.event.listen("tauri://drag-drop", ({ payload }) => {
    emitDesktop("desktop-native-drop", payload);
  }).catch((error) => console.error("[desktop] file drop listener failed:", error));
  window.electron_componentapp_API = { invoke: componentInvoke };
  window.electron_view_API = {
    getAppsList: () => invoke("get-apps-list", {}),
    getProjectRoot: () => invoke("health", {}).then((result) => result.projectRoot),
    dispatch: (type, payload) => componentInvoke("view:dispatch", type, payload),
    subscribe: () => {},
    unsubscribe: () => {},
    onStateUpdate: () => () => {},
  };
  window.electron_mainWindow_API = {
    onWindowStateChange: () => () => {},
    startResize: () => {},
    sendResizeMove: () => {},
    endResize: () => {},
    window_minimize: () => window.__TAURI__.window.getCurrentWindow().minimize(),
    window_maximize: () => window.__TAURI__.window.getCurrentWindow().toggleMaximize(),
    window_close: () => window.__TAURI__.window.getCurrentWindow().close(),
  };
  __OMNI_WINDOWS_SETTINGS_API__
})();
"#;
    let windows_settings_api = if is_windows_settings {
        r#"
  window.electron_windowsSettings_API = {
    openCategory: async (category) => {
      try {
        return await invoke("open-windows-settings-category", { category });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
"#
    } else {
        ""
    };
    let componentapp_api = match app_id.as_str() {
        "NetworkManager" => r#"
  const bluetoothListeners = new Map();
  window.electron_network_API = {
    scanWifi: () => componentInvoke("wifi:scan"),
    connectWifi: (ssid, password) => componentInvoke("wifi:connect", ssid, password),
    disconnectWifi: () => componentInvoke("wifi:disconnect"),
    getWifiStatus: () => componentInvoke("wifi:status"),
    startHotspot: (ssid, password) => componentInvoke("wifi:start-hotspot", ssid, password),
    stopHotspot: () => componentInvoke("wifi:stop-hotspot"),
    startBluetoothScan: () => componentInvoke("bluetooth:start-scan"),
    connectBluetooth: (address) => componentInvoke("bluetooth:connect", address),
    disconnectBluetooth: () => componentInvoke("bluetooth:disconnect"),
    onBluetoothDeviceFound: (callback) => {
      const listeners = bluetoothListeners.get("device-found") || new Set();
      listeners.add(callback);
      bluetoothListeners.set("device-found", listeners);
      return () => listeners.delete(callback);
    },
    onBluetoothScanFinished: (callback) => {
      const listeners = bluetoothListeners.get("scan-finished") || new Set();
      listeners.add(callback);
      bluetoothListeners.set("scan-finished", listeners);
      return () => listeners.delete(callback);
    },
  };
"#,
        "Min" => r#"
  const serverStartedListeners = new Set();
  window.electron_min_API = {
    sendNotification: (title, body) => {
      if (!("Notification" in window)) return;
      const show = () => new Notification(title, { body });
      if (Notification.permission === "granted") show();
      else if (Notification.permission === "default") {
        void Notification.requestPermission().then((permission) => {
          if (permission === "granted") show();
        });
      }
    },
    startServer: (port) => {
      void componentInvoke("start-server", port).then((result) => {
        if (!result?.success) throw new Error(result?.error || "Не удалось запустить сервер");
        for (const listener of serverStartedListeners) listener(null, result.port);
      }).catch((error) => {
        for (const listener of serverStartedListeners) {
          listener(error instanceof Error ? error.message : String(error));
        }
      });
    },
    stopServer: () => componentInvoke("stop-server"),
    onServerStarted: (callback) => {
      serverStartedListeners.add(callback);
      return () => serverStartedListeners.delete(callback);
    },
    removeServerListeners: () => serverStartedListeners.clear(),
  };
"#,
        "omni-archiver" => r#"
  const archiverProgressListeners = new Set();
  let archiverJobId = null;
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const runArchiverJob = async (channel, options) => {
    try {
      const started = await componentInvoke(channel, options);
      if (!started?.ok) return started;
      archiverJobId = started.jobId;
      while (archiverJobId) {
        await delay(200);
        const status = await componentInvoke("omni-archiver:poll", archiverJobId);
        for (const progress of status.progress || []) {
          for (const listener of archiverProgressListeners) listener(progress);
        }
        if (status.done) {
          archiverJobId = null;
          return status.result;
        }
      }
      return { ok: false, error: "Задача прервана" };
    } catch (error) {
      archiverJobId = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  window.electron_omniArchiver_API = {
    getPathForFile: (file) => file?.path || null,
    resolveOutputPath: (path) => componentInvoke("omni-archiver:resolve-output-path", path),
    readClipboard: () => componentInvoke("omni-archiver:read-clipboard"),
    saveTextToTemp: (text) => componentInvoke("omni-archiver:save-text-to-temp", text),
    enumerate: (paths) => componentInvoke("omni-archiver:enumerate", paths),
    start: (options) => runArchiverJob("omni-archiver:start", options),
    cancel: () => archiverJobId
      ? componentInvoke("omni-archiver:cancel", archiverJobId)
      : Promise.resolve({ ok: false, error: "Нет активной задачи" }),
    onProgress: (callback) => {
      archiverProgressListeners.add(callback);
      return () => archiverProgressListeners.delete(callback);
    },
    unpackFragments: (options) => runArchiverJob("omni-archiver:unpack-fragments", options),
    unpackVhd: (options) => runArchiverJob("omni-archiver:unpack-vhd", options),
  };
"#,
        "xterm" => r#"
  const terminalListeners = new Map();
  const terminalPollers = new Map();
  window.electron_componentapp_xterm_API = {
    on: (event, callback) => {
      const listeners = terminalListeners.get(event) || new Set();
      listeners.add(callback);
      terminalListeners.set(event, listeners);
      if (event === "terminal-data" && !terminalPollers.has(event)) {
        const timer = window.setInterval(async () => {
          try {
            const result = await componentInvoke("terminal-poll");
            for (const data of result.data || []) {
              for (const listener of terminalListeners.get(event) || []) listener(data);
            }
          } catch (error) {
            console.error("[xterm] terminal polling failed:", error);
          }
        }, 80);
        terminalPollers.set(event, timer);
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) {
          terminalListeners.delete(event);
          const timer = terminalPollers.get(event);
          if (timer !== undefined) window.clearInterval(timer);
          terminalPollers.delete(event);
        }
      };
    },
    send: (event, data) => {
      void componentInvoke(event, data).catch((error) => {
        console.error(`[xterm] ${event} failed:`, error);
      });
    },
  };
"#,
        _ => "",
    };
    let component_script = script
        .replace("__OMNI_APP_ID__", &app_id)
        .replace("__OMNI_PARAMS__", &params)
        .replace("__OMNI_PLATFORM__", platform)
        .replace("__OMNI_WINDOWS_SETTINGS_API__", windows_settings_api)
        .replace("__OMNI_COMPONENTAPP_API__", componentapp_api);
    Ok(format!("{theme_script}\n{component_script}"))
}

fn filesystem_root(path: &Path) -> PathBuf {
    let mut root = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => root.push(component.as_os_str()),
            _ => break,
        }
    }
    root
}

fn chonky_default_folders(
    project_root: &Path,
    directories: &Value,
    platform: &str,
) -> Result<Value, String> {
    let directory = |name: &str| {
        directories
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("User directory {name} is unavailable"))
    };
    let root_id = if platform == "win32" { "c_root" } else { "root" };
    let root_name = if platform == "win32" {
        "Диск C:"
    } else {
        "Корень ФС"
    };
    Ok(json!([
        {
            "id": root_id,
            "name": root_name,
            "path": filesystem_root(project_root),
        },
        {
            "id": "project",
            "name": "The Omniscience",
            "path": project_root,
        },
        {
            "id": "home",
            "name": "Домашняя папка",
            "path": directory("home")?,
        },
        {
            "id": "downloads",
            "name": "Загрузки",
            "path": directory("download")?,
        },
        {
            "id": "pictures",
            "name": "Картинки",
            "path": directory("pictures")?,
        },
        {
            "id": "documents",
            "name": "Документы",
            "path": directory("documents")?,
        },
        {
            "id": "music",
            "name": "Музыка",
            "path": directory("music")?,
        },
        {
            "id": "videos",
            "name": "Видео",
            "path": directory("videos")?,
        },
    ]))
}

#[tauri::command]
pub(crate) async fn componentapp_request(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, NodeBridge>,
    app_id: String,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    if app_id == "power-menu" && method == "power-menu:execute" {
        return crate::componentapp_power::perform_power_action(&payload).await;
    }
    if app_id == "Monaco" {
        match method.as_str() {
            "read-file" => return crate::componentapp_file::read_componentapp_file(&payload),
            "write-file" => return crate::componentapp_file::write_componentapp_file(&payload),
            "check-text-file" => {
                return crate::componentapp_file::check_componentapp_text_file(&payload);
            }
            _ => {}
        }
    }
    if matches!(app_id.as_str(), "Chonky" | "Monaco") && method == "get-files" {
        let path = payload.as_array().and_then(|arguments| arguments.first());
        return crate::componentapp_files::list_componentapp_files(path.and_then(Value::as_str));
    }
    if matches!(app_id.as_str(), "Chonky" | "Monaco") && method == "get-default-folders" {
        let project_root = crate::node::runtime_root(&app)?;
        let directories = crate::node::filesystem::user_directories()?;
        let platform = if cfg!(target_os = "windows") {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };
        return chonky_default_folders(&project_root, &directories, platform);
    }
    if crate::componentapp_backends::has_backend(&app_id) {
        return crate::componentapp_backends::dispatch(&app_id, &method, payload);
    }

    call_node(
        Arc::clone(&state.0),
        "componentapp-ipc".to_string(),
        json!({
            "appId": app_id,
            "channel": method,
            "args": payload,
            "windowId": window.label(),
        }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{chonky_default_folders, filesystem_root};
    use serde_json::json;
    use std::env;

    #[test]
    fn chonky_default_folders_keep_legacy_order_and_root() {
        let project_root = env::temp_dir().join("Omniscience");
        let directories = json!({
            "home": "C:/Users/Test",
            "download": "C:/Users/Test/Downloads",
            "pictures": "C:/Users/Test/Pictures",
            "documents": "C:/Users/Test/Documents",
            "music": "C:/Users/Test/Music",
            "videos": "C:/Users/Test/Videos",
        });
        let folders = chonky_default_folders(&project_root, &directories, "win32").unwrap();
        assert_eq!(folders[0]["id"], "c_root");
        assert_eq!(folders[0]["path"], json!(filesystem_root(&project_root)));
        assert_eq!(folders[1]["id"], "project");
        assert_eq!(folders[2]["id"], "home");
        assert_eq!(folders[3]["id"], "downloads");
        assert_eq!(folders[7]["id"], "videos");
        assert!(chonky_default_folders(&project_root, &json!({}), "linux").is_err());
    }
}
