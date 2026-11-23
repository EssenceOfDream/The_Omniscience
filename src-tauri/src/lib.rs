use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

static PROGRAM_WINDOW_ID: AtomicU64 = AtomicU64::new(1);
const WINDOW_CONTROLS_WIDTH: f64 = 104.0;
const WINDOW_CONTROLS_HEIGHT: f64 = 62.0;
const WINDOW_CONTROLS_BOTTOM_PADDING: f64 = 0.0;

mod componentapp_backends {
    include!(concat!(env!("OUT_DIR"), "/componentapp_backends.rs"));
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedProgramWindow {
    label: String,
    title: String,
    minimized: bool,
    focused: bool,
    maximized: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgramWindowSettings {
    label: String,
    title: String,
    always_on_top: bool,
}

struct NodeRuntime {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    request_id: u64,
}

impl Drop for NodeRuntime {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct NodeBridge(Arc<Mutex<NodeRuntime>>);

#[derive(Clone, Copy)]
struct WindowBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy)]
struct WorkspaceGeometry {
    screen: WindowBounds,
    panel: WindowBounds,
    controls: WindowBounds,
    taskbar_height: f64,
}

fn start_node_bridge() -> Result<NodeRuntime, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir
        .join("..")
        .canonicalize()
        .map_err(|error| format!("Could not resolve standalone project root: {error}"))?;
    let script_path = manifest_dir
        .join("../node/bridge.mjs")
        .canonicalize()
        .map_err(|error| format!("Could not resolve Node bridge: {error}"))?;

    let mut child = Command::new("node")
        .arg(script_path)
        .arg(&project_root)
        .arg(std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Could not start Node.js sidecar: {error}"))?;

    let input = child
        .stdin
        .take()
        .ok_or_else(|| "Node.js sidecar stdin is unavailable".to_string())?;
    let output = child
        .stdout
        .take()
        .ok_or_else(|| "Node.js sidecar stdout is unavailable".to_string())?;

    Ok(NodeRuntime {
        child,
        input,
        output: BufReader::new(output),
        request_id: 0,
    })
}

fn close_workspace_on_window_close(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            app.exit(0);
        }
    });
}

fn window_chrome_initialization_script() -> &'static str {
    r#"(()=>{let b=document.getElementById('__omni_window_border__');if(!b){b=document.createElement('div');b.id='__omni_window_border__';b.setAttribute('aria-hidden','true');document.documentElement.appendChild(b);}Object.assign(b.style,{position:'fixed',inset:'0',border:'1px dashed #00ffff',boxSizing:'border-box',pointerEvents:'none',zIndex:'2147483647'});})();"#
}

fn get_primary_screen_bounds(window: &WebviewWindow) -> Result<(WindowBounds, f64), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|error| format!("Could not find the primary monitor: {error}"))?
        .ok_or_else(|| "No primary monitor is available".to_string())?;
    let scale_factor = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    Ok((
        WindowBounds {
            x: f64::from(position.x) / scale_factor,
            y: f64::from(position.y) / scale_factor,
            width: f64::from(size.width) / scale_factor,
            height: f64::from(size.height) / scale_factor,
        },
        scale_factor,
    ))
}

fn calculate_workspace_geometry(screen: WindowBounds, taskbar_height: f64) -> WorkspaceGeometry {
    let is_windows = cfg!(target_os = "windows");
    let panel_height = if is_windows { 28.0 } else { 72.0 };
    let controls_width = WINDOW_CONTROLS_WIDTH.min(screen.width);
    let panel = if is_windows {
        WindowBounds {
            x: screen.x + controls_width,
            y: screen.y + taskbar_height,
            width: (screen.width - controls_width).max(1.0),
            height: panel_height,
        }
    } else {
        WindowBounds {
            x: screen.x,
            y: screen.y,
            width: screen.width.max(1.0),
            height: panel_height,
        }
    };
    let controls = WindowBounds {
        x: screen.x,
        y: if is_windows {
            screen.y
        } else {
            screen.y + panel_height
        },
        width: controls_width,
        height: if is_windows {
            (taskbar_height + panel_height + WINDOW_CONTROLS_BOTTOM_PADDING)
                .max(WINDOW_CONTROLS_HEIGHT)
        } else {
            180.0
        },
    };
    WorkspaceGeometry {
        screen,
        panel,
        controls,
        taskbar_height,
    }
}

fn apply_window_bounds(
    window: &WebviewWindow,
    bounds: WindowBounds,
    name: &str,
) -> Result<(), String> {
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("Could not read the {name} window scale: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("Could not read the {name} window position: {error}"))?
        .to_logical::<f64>(scale_factor);
    let size = window
        .inner_size()
        .map_err(|error| format!("Could not read the {name} window size: {error}"))?
        .to_logical::<f64>(scale_factor);

    if (position.x - bounds.x).abs() > 0.5 || (position.y - bounds.y).abs() > 0.5 {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                bounds.x, bounds.y,
            )))
            .map_err(|error| format!("Could not position the {name} window: {error}"))?;
    }
    if (size.width - bounds.width).abs() > 0.5 || (size.height - bounds.height).abs() > 0.5 {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                bounds.width,
                bounds.height,
            )))
            .map_err(|error| format!("Could not size the {name} window: {error}"))?;
    }
    Ok(())
}

fn force_workspace_positions(
    app: &AppHandle,
    taskbar_height: f64,
) -> Result<WorkspaceGeometry, String> {
    let desktop = app
        .get_webview_window("desktop")
        .ok_or_else(|| "The desktop window was not created".to_string())?;
    let (screen, _) = get_primary_screen_bounds(&desktop)?;
    let geometry = calculate_workspace_geometry(screen, taskbar_height);
    let panel = app
        .get_webview_window("panel")
        .ok_or_else(|| "The workspace panel was not created".to_string())?;
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| "The window controls were not created".to_string())?;
    let mut errors = Vec::new();

    if let Err(error) = apply_window_bounds(&desktop, geometry.screen, "desktop") {
        errors.push(error);
    }
    if let Err(error) = desktop.set_always_on_bottom(true) {
        errors.push(format!(
            "Could not place the desktop behind other windows: {error}"
        ));
    }
    if let Err(error) = apply_window_bounds(&panel, geometry.panel, "workspace panel") {
        errors.push(error);
    }
    if let Err(error) = panel.set_always_on_top(true) {
        errors.push(format!(
            "Could not keep the workspace panel on top: {error}"
        ));
    }
    if let Err(error) = apply_window_bounds(&controls, geometry.controls, "window controls") {
        errors.push(error);
    }
    if let Err(error) = controls.set_always_on_top(true) {
        errors.push(format!(
            "Could not keep the window controls on top: {error}"
        ));
    }

    if errors.is_empty() {
        Ok(geometry)
    } else {
        Err(errors.join("; "))
    }
}

fn start_workspace_position_watchdog(app: AppHandle, taskbar_height: f64) {
    thread::spawn(move || {
        loop {
            if app.get_webview_window("desktop").is_none() {
                break;
            }
            if let Err(error) = force_workspace_positions(&app, taskbar_height) {
                eprintln!("[workspace] failed to enforce shell window placement: {error}");
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

fn configure_workspace_windows(app: &mut tauri::App) -> Result<WorkspaceGeometry, String> {
    let desktop = app
        .get_webview_window("desktop")
        .ok_or_else(|| "The desktop window was not created".to_string())?;
    let (screen, scale_factor) = get_primary_screen_bounds(&desktop)?;
    let _ = desktop.eval(window_chrome_initialization_script());

    let node_bridge = app.state::<NodeBridge>();
    let mut runtime = node_bridge
        .0
        .lock()
        .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
    #[cfg(target_os = "windows")]
    let taskbar_height = {
        let status = request_node(&mut runtime, "explorer-shell-status", json!({}))?;
        status
            .get("taskbarBounds")
            .and_then(|bounds| bounds.get("height"))
            .and_then(Value::as_f64)
            .filter(|height| *height > 0.0)
            .ok_or_else(|| "Windows did not report the primary taskbar bounds".to_string())?
            / scale_factor
    };
    #[cfg(not(target_os = "windows"))]
    let taskbar_height = 0.0;
    drop(runtime);

    let geometry = calculate_workspace_geometry(screen, taskbar_height);
    apply_window_bounds(&desktop, geometry.screen, "desktop")?;
    desktop
        .set_always_on_bottom(true)
        .map_err(|error| format!("Could not place the desktop behind other windows: {error}"))?;

    let panel =
        WebviewWindowBuilder::new(app, "panel", WebviewUrl::App(PathBuf::from("panel.html")))
            .title("Omniscience panel")
            .position(geometry.panel.x, geometry.panel.y)
            .inner_size(geometry.panel.width, geometry.panel.height)
            .decorations(false)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .transparent(true)
            .shadow(false)
            .focusable(false)
            .focused(false)
            .visible(false)
            .initialization_script(window_chrome_initialization_script())
            .build()
            .map_err(|error| format!("Could not create the workspace panel: {error}"))?;

    let controls = WebviewWindowBuilder::new(
        app,
        "controls",
        WebviewUrl::App(PathBuf::from("controls.html")),
    )
    .title("Omniscience window controls")
    .position(geometry.controls.x, geometry.controls.y)
    .inner_size(geometry.controls.width, geometry.controls.height)
    .decorations(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .transparent(true)
    .shadow(false)
    .focusable(false)
    .focused(false)
    .visible(false)
    .initialization_script(window_chrome_initialization_script())
    .build()
    .map_err(|error| format!("Could not create the window controls: {error}"))?;

    let app_handle = app.handle().clone();
    close_workspace_on_window_close(&desktop, app_handle.clone());
    close_workspace_on_window_close(&panel, app_handle.clone());
    close_workspace_on_window_close(&controls, app_handle);

    desktop
        .show()
        .map_err(|error| format!("Could not show the desktop window: {error}"))?;
    panel
        .show()
        .map_err(|error| format!("Could not show the workspace panel: {error}"))?;
    controls
        .show()
        .map_err(|error| format!("Could not show the window controls: {error}"))?;

    force_workspace_positions(app.handle(), taskbar_height)
}

fn request_node(runtime: &mut NodeRuntime, method: &str, payload: Value) -> Result<Value, String> {
    if let Some(status) = runtime
        .child
        .try_wait()
        .map_err(|error| format!("Could not check Node.js sidecar: {error}"))?
    {
        return Err(format!("Node.js sidecar exited with status {status}"));
    }

    runtime.request_id += 1;
    let request_id = runtime.request_id;
    let request = json!({ "id": request_id, "method": method, "payload": payload });
    serde_json::to_writer(&mut runtime.input, &request)
        .map_err(|error| format!("Could not encode sidecar request: {error}"))?;
    runtime
        .input
        .write_all(b"\n")
        .and_then(|_| runtime.input.flush())
        .map_err(|error| format!("Could not send sidecar request: {error}"))?;

    let mut line = String::new();
    runtime
        .output
        .read_line(&mut line)
        .map_err(|error| format!("Could not read sidecar response: {error}"))?;
    if line.is_empty() {
        return Err("Node.js sidecar closed its response stream".to_string());
    }

    let response: Value = serde_json::from_str(&line)
        .map_err(|error| format!("Invalid Node.js sidecar response: {error}"))?;
    if response.get("id").and_then(Value::as_u64) != Some(request_id) {
        return Err("Node.js sidecar returned a mismatched request id".to_string());
    }
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Node.js sidecar request failed")
            .to_string());
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| "Node.js sidecar response is missing its result".to_string())
}

fn component_app_init_script(
    app_id: &str,
    params: &Value,
    theme_settings: &Value,
    is_windows_settings: bool,
) -> Result<String, String> {
    let app_id = serde_json::to_string(app_id)
        .map_err(|error| format!("Could not encode componentapp id: {error}"))?;
    let params = serde_json::to_string(params)
        .map_err(|error| format!("Could not encode componentapp parameters: {error}"))?;
    let theme_settings = serde_json::to_string(theme_settings)
        .map_err(|error| format!("Could not encode componentapp theme settings: {error}"))?;
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
  window.electron_desktop_API = {
    platform: "__OMNI_PLATFORM__",
    getProjectRoot: () => invoke("health", {}).then((result) => result.projectRoot),
    getUserDirs: () => invoke("get-user-dirs", {}),
    getAppsList: () => invoke("get-apps-list", {}),
    closeWindow: () => window.__TAURI__.window.getCurrentWindow().close(),
    invoke: (channel, ...args) => componentInvoke(channel, ...args),
    createFolder: (dir, name) => operation("create-folder", { parentPath: dir, name }),
    createFile: (dir, name) => operation("create-file", { parentPath: dir, name }),
    renamePath: (path, name) => operation("rename-path", { path, name }),
  };
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
  try {
    localStorage.setItem("__omni_settings__", JSON.stringify(__OMNI_THEME_SETTINGS__));
  } catch (error) {
    console.error("[tauri-componentapp] could not store theme settings:", error);
  }
  const installTheme = () => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/omniscience/__omniscience/theme/base.css";
    document.head.appendChild(stylesheet);
    const themeScript = document.createElement("script");
    themeScript.src = "/omniscience/__omniscience/theme/content.js";
    document.head.appendChild(themeScript);
  };
  const border = document.createElement("div");
  border.id = "__omni_window_border__";
  border.setAttribute("aria-hidden", "true");
  Object.assign(border.style, {
    position: "fixed",
    inset: "0",
    border: "1px dashed #00ffff",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(border);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installTheme, { once: true });
  } else {
    installTheme();
  }
})();
"#;
    let windows_settings_api = if is_windows_settings {
        r#"
  window.electron_windowsSettings_API = {
    openCategory: async (category) => {
      try {
        return await invoke("node_request", {
          method: "open-windows-settings-category",
          payload: { category },
        });
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
    Ok(script
        .replace("__OMNI_APP_ID__", &app_id)
        .replace("__OMNI_PARAMS__", &params)
        .replace("__OMNI_THEME_SETTINGS__", &theme_settings)
        .replace("__OMNI_PLATFORM__", platform)
        .replace("__OMNI_WINDOWS_SETTINGS_API__", windows_settings_api))
}

async fn call_node(
    runtime: Arc<Mutex<NodeRuntime>>,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut runtime = runtime
            .lock()
            .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
        request_node(&mut runtime, &method, payload)
    })
    .await
    .map_err(|error| format!("Node.js sidecar task failed: {error}"))?
}

#[tauri::command]
async fn node_request(
    state: State<'_, NodeBridge>,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    call_node(Arc::clone(&state.0), method, payload).await
}

#[tauri::command]
async fn update_theme(
    app: AppHandle,
    state: State<'_, NodeBridge>,
    settings: Value,
) -> Result<(), String> {
    let settings = call_node(Arc::clone(&state.0), "set-theme".to_string(), settings).await?;
    let settings = serde_json::to_string(&settings)
        .map_err(|error| format!("Could not encode Omni Theme settings: {error}"))?;
    let script = format!(
        "(()=>{{const settings={settings};localStorage.setItem('__omni_settings__',JSON.stringify(settings));window.dispatchEvent(new CustomEvent('__omni_settings_updated__',{{detail:settings}}));}})();"
    );

    for (label, window) in app.webview_windows() {
        if label == "desktop"
            || label == "overview"
            || label == "panel"
            || label == "controls"
            || label == "window-settings"
            || label.starts_with("program-")
            || label.starts_with("component-")
        {
            window
                .eval(&script)
                .map_err(|error| format!("Could not update theme in {label}: {error}"))?;
        }
    }
    Ok(())
}

fn build_overview_window(app: &AppHandle, geometry: WorkspaceGeometry) -> Result<(), String> {
    let desktop = app
        .get_webview_window("desktop")
        .ok_or_else(|| "The desktop window was not created".to_string())?;
    let (screen, _) = get_primary_screen_bounds(&desktop)?;
    let geometry = calculate_workspace_geometry(screen, geometry.taskbar_height);
    let overview_y = geometry.panel.y + geometry.panel.height;
    let overview_height = (geometry.screen.y + geometry.screen.height - overview_y).max(1.0);
    let overview = WebviewWindowBuilder::new(
        app,
        "overview",
        WebviewUrl::App(PathBuf::from("overview.html")),
    )
    .title("Omniscience overview")
    .position(geometry.screen.x, overview_y)
    .inner_size(geometry.screen.width, overview_height)
    .decorations(false)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .transparent(true)
    .shadow(false)
    .focused(false)
    .visible(false)
    .initialization_script(window_chrome_initialization_script())
    .build()
    .map_err(|error| format!("Could not open the workspace overview: {error}"))?;
    let app_handle = app.clone();
    overview.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let _ = app_handle.emit("overview-closed", ());
        }
    });
    overview
        .show()
        .map_err(|error| format!("Could not show the workspace overview: {error}"))?;
    overview
        .set_focus()
        .map_err(|error| format!("Could not focus the workspace overview: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn toggle_overview(
    app: AppHandle,
    geometry: State<'_, WorkspaceGeometry>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        return window
            .close()
            .map_err(|error| format!("Could not close the workspace overview: {error}"));
    }
    build_overview_window(&app, *geometry)
}

#[tauri::command]
async fn open_overview(
    app: AppHandle,
    geometry: State<'_, WorkspaceGeometry>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        return window
            .set_focus()
            .map_err(|error| format!("Could not focus the workspace overview: {error}"));
    }
    build_overview_window(&app, *geometry)
}

#[tauri::command]
fn close_overview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        window
            .close()
            .map_err(|error| format!("Could not close the workspace overview: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn list_program_windows(app: AppHandle) -> Result<Vec<ManagedProgramWindow>, String> {
    let mut windows = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("program-") || label.starts_with("component-"))
        .map(|(label, window)| {
            let scale_factor = window
                .scale_factor()
                .map_err(|error| format!("Could not read window scale: {error}"))?;
            let position = window
                .outer_position()
                .map_err(|error| format!("Could not read window position: {error}"))?
                .to_logical::<f64>(scale_factor);
            let size = window
                .outer_size()
                .map_err(|error| format!("Could not read window size: {error}"))?
                .to_logical::<f64>(scale_factor);
            Ok(ManagedProgramWindow {
                label,
                title: window
                    .title()
                    .map_err(|error| format!("Could not read window title: {error}"))?,
                minimized: window
                    .is_minimized()
                    .map_err(|error| format!("Could not read window state: {error}"))?,
                focused: window
                    .is_focused()
                    .map_err(|error| format!("Could not read window state: {error}"))?,
                maximized: window
                    .is_maximized()
                    .map_err(|error| format!("Could not read window state: {error}"))?,
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    windows.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(windows)
}

fn get_program_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    if !label.starts_with("program-") && !label.starts_with("component-") {
        return Err("Only program windows can be managed here".to_string());
    }
    app.get_webview_window(label)
        .ok_or_else(|| format!("Program window {label} is no longer open"))
}

#[tauri::command]
async fn open_window_settings(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?;
    if let Some(settings) = app.get_webview_window("window-settings") {
        app.emit_to("window-settings", "window-settings-target-changed", label)
            .map_err(|error| format!("Could not update window settings: {error}"))?;
        settings
            .show()
            .and_then(|_| settings.set_focus())
            .map_err(|error| format!("Could not open window settings: {error}"))?;
        return Ok(());
    }

    let script_value = serde_json::to_string(&label)
        .map_err(|error| format!("Could not encode target window label: {error}"))?;
    WebviewWindowBuilder::new(
        &app,
        "window-settings",
        WebviewUrl::App(PathBuf::from("window-settings.html")),
    )
    .title("Параметры окна")
    .center()
    .inner_size(340.0, 360.0)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .transparent(true)
    .shadow(false)
    .focused(true)
    .initialization_script(format!(
        "window.__OMNI_WINDOW_SETTINGS_TARGET__ = {script_value};{}",
        window_chrome_initialization_script()
    ))
    .build()
    .map_err(|error| format!("Could not create window settings: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_program_window_settings(
    app: AppHandle,
    label: String,
) -> Result<ProgramWindowSettings, String> {
    let window = get_program_window(&app, &label)?;
    Ok(ProgramWindowSettings {
        label,
        title: window
            .title()
            .map_err(|error| format!("Could not read window title: {error}"))?,
        always_on_top: window
            .is_always_on_top()
            .map_err(|error| format!("Could not read window layer: {error}"))?,
    })
}

#[tauri::command]
fn set_program_window_layer(app: AppHandle, label: String, layer: String) -> Result<(), String> {
    let window = get_program_window(&app, &label)?;
    match layer.as_str() {
        "top" => window
            .set_always_on_bottom(false)
            .and_then(|_| window.set_always_on_top(true)),
        "normal" => window
            .set_always_on_top(false)
            .and_then(|_| window.set_always_on_bottom(false)),
        "bottom" => window
            .set_always_on_top(false)
            .and_then(|_| window.set_always_on_bottom(true)),
        _ => return Err(format!("Unsupported window layer: {layer}")),
    }
    .map_err(|error| format!("Could not change {label} window layer: {error}"))
}

#[tauri::command]
fn reload_program_window(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?
        .reload()
        .map_err(|error| format!("Could not reload {label}: {error}"))
}

#[tauri::command]
fn open_program_devtools(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?.open_devtools();
    Ok(())
}

#[tauri::command]
fn manage_program_window(app: AppHandle, label: String, action: String) -> Result<(), String> {
    if !label.starts_with("program-") && !label.starts_with("component-") {
        return Err("Only program windows can be managed here".to_string());
    }

    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Program window {label} is no longer open"))?;
    match action.as_str() {
        "focus" => {
            if window
                .is_minimized()
                .map_err(|error| format!("Could not read window state: {error}"))?
            {
                window
                    .unminimize()
                    .map_err(|error| format!("Could not restore {label}: {error}"))?;
            }
            window
                .set_focus()
                .map_err(|error| format!("Could not focus {label}: {error}"))?;
        }
        "minimize" => window
            .minimize()
            .map_err(|error| format!("Could not minimize {label}: {error}"))?,
        "maximize" => {
            if window
                .is_maximized()
                .map_err(|error| format!("Could not read window state: {error}"))?
            {
                window
                    .unmaximize()
                    .map_err(|error| format!("Could not restore {label}: {error}"))?;
            } else {
                window
                    .maximize()
                    .map_err(|error| format!("Could not maximize {label}: {error}"))?;
            }
        }
        "close" => window
            .close()
            .map_err(|error| format!("Could not close {label}: {error}"))?,
        _ => return Err(format!("Unsupported window action: {action}")),
    }

    app.emit("managed-windows-changed", ())
        .map_err(|error| format!("Could not notify the workspace: {error}"))?;
    Ok(())
}

#[tauri::command]
fn set_program_window_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if ![x, y, width, height].into_iter().all(f64::is_finite) || width <= 0.0 || height <= 0.0 {
        return Err("Invalid program window bounds".to_string());
    }
    if !label.starts_with("program-") && !label.starts_with("component-") {
        return Err("Only program windows can be resized here".to_string());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Program window {label} is no longer open"))?;
    window
        .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)))
        .map_err(|error| format!("Could not move {label}: {error}"))?;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|error| format!("Could not resize {label}: {error}"))?;
    app.emit("managed-windows-changed", ())
        .map_err(|error| format!("Could not notify the workspace: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn open_program(
    app: AppHandle,
    state: State<'_, NodeBridge>,
    program_id: String,
    params: Value,
) -> Result<(), String> {
    let result = call_node(
        Arc::clone(&state.0),
        "open-program".to_string(),
        json!({ "programId": program_id, "params": params }),
    )
    .await?;
    let name = result
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "Node.js sidecar returned no program name".to_string())?;
    let window_id = PROGRAM_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let kind = result
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "Node.js sidecar returned no program type".to_string())?;
    let (label, builder) = if kind == "componentapp" {
        let app_path = result
            .get("appPath")
            .and_then(Value::as_str)
            .ok_or_else(|| "Node.js sidecar returned no componentapp path".to_string())?;
        let theme_settings = result
            .get("themeSettings")
            .ok_or_else(|| "Node.js sidecar returned no theme settings".to_string())?;
        let script =
            component_app_init_script(name, &params, theme_settings, name == "windows-settings")?;
        let (width, height) = if name == "windows-settings" {
            (1120.0, 800.0)
        } else {
            (400.0, 190.0)
        };
        let label = format!("component-{window_id}");
        let builder = WebviewWindowBuilder::new(
            &app,
            label.clone(),
            WebviewUrl::App(PathBuf::from(app_path)),
        )
        .title(name)
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .initialization_script(script);
        (label, builder)
    } else {
        let url = result
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Node.js sidecar returned no program URL".to_string())?
            .parse()
            .map_err(|error| format!("Node.js sidecar returned an invalid URL: {error}"))?;
        let label = format!("program-{window_id}");
        let builder = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::External(url))
            .title(name)
            .inner_size(1000.0, 720.0)
            .initialization_script(window_chrome_initialization_script());
        (label, builder)
    };

    let window = builder
        .build()
        .map_err(|error| format!("Could not open {label}: {error}"))?;
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Destroyed | tauri::WindowEvent::Focused(_)
        ) {
            let _ = app_handle.emit("managed-windows-changed", ());
        }
    });
    app.emit("managed-windows-changed", ())
        .map_err(|error| format!("Could not notify the workspace: {error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let runtime = start_node_bridge().map_err(std::io::Error::other)?;
            app.manage(NodeBridge(Arc::new(Mutex::new(runtime))));
            let geometry = configure_workspace_windows(app).map_err(std::io::Error::other)?;
            app.manage(geometry);
            start_workspace_position_watchdog(app.handle().clone(), geometry.taskbar_height);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            node_request,
            componentapp_request,
            toggle_overview,
            open_overview,
            close_overview,
            open_program,
            update_theme,
            list_program_windows,
            manage_program_window,
            set_program_window_bounds,
            open_window_settings,
            get_program_window_settings,
            set_program_window_layer,
            reload_program_window,
            open_program_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn componentapp_request(
    state: State<'_, NodeBridge>,
    app_id: String,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    if componentapp_backends::has_backend(&app_id) {
        return componentapp_backends::dispatch(&app_id, &method, payload);
    }

    call_node(
        Arc::clone(&state.0),
        "componentapp-ipc".to_string(),
        json!({ "appId": app_id, "channel": method, "args": payload }),
    )
    .await
}
