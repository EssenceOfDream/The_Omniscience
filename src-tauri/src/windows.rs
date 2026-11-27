use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
    webview::{NewWindowFeatures, NewWindowResponse},
};
use tauri_plugin_opener::OpenerExt;

use crate::{
    componentapp::component_app_init_script,
    node::{call_node, runtime_root},
    programs::{encode_uri_component, find_program, list_programs, program_icon},
    state::{
        ManagedProgramWindow, ProgramWindowIcons, ProgramWindowSettings, WindowBounds,
        WorkspaceGeometry, window_backdrop_effects,
    },
    theme::{current_theme_settings, window_chrome_initialization_script},
    workspace::{
        below_panel_bounds, calculate_workspace_geometry, get_primary_screen_bounds,
        set_windows_shell_layer,
    },
};

static PROGRAM_WINDOW_ID: AtomicU64 = AtomicU64::new(1);
static POPUP_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn is_supported_popup_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https") || (url.scheme() == "about" && url.path() == "blank")
}

fn popup_window_handler(
    app: AppHandle,
) -> impl Fn(tauri::Url, NewWindowFeatures) -> NewWindowResponse<tauri::Wry> + Send + 'static {
    move |url, features| {
        if matches!(url.scheme(), "mailto" | "tel") {
            if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
                eprintln!("[popup] could not open external URI {url}: {error}");
            }
            return NewWindowResponse::Deny;
        }

        if !is_supported_popup_url(&url) {
            eprintln!("[popup] blocked unsupported URL: {url}");
            return NewWindowResponse::Deny;
        }

        let theme_settings = match current_theme_settings(&app) {
            Ok(settings) => settings,
            Err(error) => {
                eprintln!("[popup] could not read Omni Theme settings: {error}");
                return NewWindowResponse::Deny;
            }
        };
        let target = if url.path().starts_with("/extensions/") {
            "extensions"
        } else {
            "webapps"
        };
        let initialization_script =
            match window_chrome_initialization_script(&theme_settings, target) {
                Ok(script) => script,
                Err(error) => {
                    eprintln!("[popup] could not prepare Omni Theme: {error}");
                    return NewWindowResponse::Deny;
                }
            };

        let id = POPUP_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
        let label = format!("program-popup-{id}");
        let title = url.host_str().unwrap_or("Popup").to_string();
        let app_handle = app.clone();
        let builder =
            WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::External(url.clone()))
                .window_features(features)
                .title(title)
                .devtools(true)
                .decorations(false)
                .transparent(true)
                .effects(window_backdrop_effects())
                .initialization_script(initialization_script)
                .on_new_window(popup_window_handler(app.clone()))
                .on_document_title_changed(|window, title| {
                    if let Err(error) = window.set_title(&title) {
                        eprintln!("[popup] could not update window title: {error}");
                    }
                });

        match builder.build() {
            Ok(window) => {
                let event_app = app_handle.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed | WindowEvent::Focused(_)) {
                        if let Err(error) = event_app.emit("managed-windows-changed", ()) {
                            eprintln!(
                                "[popup] could not notify workspace about window changes: {error}"
                            );
                        }
                    }
                });
                if let Err(error) = app_handle.emit("managed-windows-changed", ()) {
                    eprintln!("[popup] could not notify workspace about the new window: {error}");
                }
                NewWindowResponse::Create { window }
            }
            Err(error) => {
                eprintln!("[popup] could not create window for {url}: {error}");
                NewWindowResponse::Deny
            }
        }
    }
}

fn configure_overlay_builder<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
    bounds: WindowBounds,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
        .position(bounds.x, bounds.y)
        .inner_size(bounds.width, bounds.height)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .shadow(false)
}

fn build_overview_window(app: &AppHandle, geometry: WorkspaceGeometry) -> Result<(), String> {
    let desktop = app
        .get_webview_window("desktop")
        .ok_or_else(|| "The desktop window was not created".to_string())?;
    let (screen, _) = get_primary_screen_bounds(&desktop)?;
    let theme_settings = current_theme_settings(app)?;
    let initialization_script = window_chrome_initialization_script(&theme_settings, "shell")?;
    let geometry = calculate_workspace_geometry(screen, geometry.taskbar_height);
    let bounds = below_panel_bounds(geometry);

    let builder = WebviewWindowBuilder::new(
        app,
        "overview",
        WebviewUrl::App(PathBuf::from("overview.html")),
    )
    .title("Omniscience overview")
    .devtools(true)
    .focused(false)
    .visible(false)
    .initialization_script(initialization_script)
    .effects(window_backdrop_effects());

    let overview = configure_overlay_builder(builder, bounds)
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
    set_windows_shell_layer(app, &overview, "top")?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn toggle_overview(
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
pub(crate) async fn open_overview(
    app: AppHandle,
    geometry: State<'_, WorkspaceGeometry>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        window
            .set_focus()
            .map_err(|error| format!("Could not focus the workspace overview: {error}"))?;
        return set_windows_shell_layer(&app, &window, "top");
    }
    build_overview_window(&app, *geometry)
}

#[tauri::command]
pub(crate) fn close_overview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overview") {
        window
            .close()
            .map_err(|error| format!("Could not close the workspace overview: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_program_windows(
    app: AppHandle,
    icons: State<'_, ProgramWindowIcons>,
) -> Result<Vec<ManagedProgramWindow>, String> {
    let icons = icons
        .0
        .lock()
        .map_err(|_| "Program window icon state is unavailable".to_string())?
        .clone();
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
                icon: icons.get(&label).cloned(),
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
pub(crate) async fn prepare_program_window_drag(
    app: AppHandle,
    state: State<'_, crate::node::NodeBridge>,
    label: String,
    mode: String,
    direction: Option<String>,
) -> Result<Value, String> {
    let window = get_program_window(&app, &label)?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus {label} before dragging: {error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("Could not read window position: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("Could not read window size: {error}"))?;
    let width = i32::try_from(size.width)
        .map_err(|_| "Window width is outside the supported range".to_string())?;
    let height = i32::try_from(size.height)
        .map_err(|_| "Window height is outside the supported range".to_string())?;
    if width <= 0 || height <= 0 {
        return Err("Window has invalid bounds".to_string());
    }

    let right = position.x + width - 1;
    let bottom = position.y + height - 1;
    let center_x = position.x + width / 2;
    let center_y = position.y + height / 2;
    let cursor = match (mode.as_str(), direction.as_deref()) {
        ("move", _) => (center_x, position.y + 20.min((height / 3).max(1))),
        ("resize", Some("nw")) => (position.x, position.y),
        ("resize", Some("n")) => (center_x, position.y),
        ("resize", Some("ne")) => (right, position.y),
        ("resize", Some("e")) => (right, center_y),
        ("resize", Some("se")) => (right, bottom),
        ("resize", Some("s")) => (center_x, bottom),
        ("resize", Some("sw")) => (position.x, bottom),
        ("resize", Some("w")) => (position.x, center_y),
        _ => return Err("Invalid window drag mode or resize direction".to_string()),
    };
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("Could not read window scale: {error}"))?;
    let logical_position = position.to_logical::<f64>(scale_factor);
    let logical_size = size.to_logical::<f64>(scale_factor);
    let mut response = json!({
        "ok": true,
        "bounds": {
            "x": logical_position.x,
            "y": logical_position.y,
            "width": logical_size.width,
            "height": logical_size.height
        }
    });

    if cfg!(target_os = "windows") {
        let result = call_node(
            Arc::clone(&state.0),
            "set-cursor-position".to_string(),
            json!({ "x": cursor.0, "y": cursor.1 }),
        )
        .await?;
        if result.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err("Could not move the cursor to the window".to_string());
        }
        response["cursor"] = json!({
            "x": cursor.0 as f64 / scale_factor,
            "y": cursor.1 as f64 / scale_factor
        });
    }

    Ok(response)
}

#[tauri::command]
pub(crate) async fn open_window_settings(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?;
    if let Some(settings) = app.get_webview_window("window-settings") {
        app.emit_to("window-settings", "window-settings-target-changed", label)
            .map_err(|error| format!("Could not update window settings: {error}"))?;
        settings
            .show()
            .and_then(|_| settings.set_focus())
            .map_err(|error| format!("Could not open window settings: {error}"))?;
        return set_windows_shell_layer(&app, &settings, "top");
    }

    let script_value = serde_json::to_string(&label)
        .map_err(|error| format!("Could not encode target window label: {error}"))?;
    let theme_settings = current_theme_settings(&app)?;
    let initialization_script = window_chrome_initialization_script(&theme_settings, "shell")?;
    let settings = WebviewWindowBuilder::new(
        &app,
        "window-settings",
        WebviewUrl::App(PathBuf::from("window-settings.html")),
    )
    .title("Параметры окна")
    .devtools(true)
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
        "{initialization_script}window.__OMNI_WINDOW_SETTINGS_TARGET__ = {script_value};"
    ))
    .effects(window_backdrop_effects())
    .build()
    .map_err(|error| format!("Could not create window settings: {error}"))?;
    set_windows_shell_layer(&app, &settings, "top")
}

#[tauri::command]
pub(crate) fn get_program_window_settings(
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
pub(crate) fn set_program_window_layer(
    app: AppHandle,
    label: String,
    layer: String,
) -> Result<(), String> {
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
pub(crate) fn reload_program_window(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?
        .reload()
        .map_err(|error| format!("Could not reload {label}: {error}"))
}

#[tauri::command]
pub(crate) fn open_program_devtools(app: AppHandle, label: String) -> Result<(), String> {
    get_program_window(&app, &label)?.open_devtools();
    Ok(())
}

#[tauri::command]
pub(crate) fn manage_program_window(
    app: AppHandle,
    label: String,
    action: String,
) -> Result<(), String> {
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
pub(crate) fn set_program_window_bounds(
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
pub(crate) async fn open_program(
    app: AppHandle,
    state: State<'_, crate::node::NodeBridge>,
    geometry: State<'_, WorkspaceGeometry>,
    program_id: String,
    params: Value,
) -> Result<(), String> {
    let project_root = runtime_root(&app)?;
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let programs = list_programs(&project_root, platform)?;
    let program =
        find_program(&programs, &program_id).ok_or_else(|| "Program not found".to_string())?;
    let name = program["name"]
        .as_str()
        .ok_or_else(|| "Program name is missing".to_string())?;
    let category = program["category"]
        .as_str()
        .ok_or_else(|| "Program category is missing".to_string())?;
    let result = if category == "extensions" && params["popup"] == true {
        crate::extensions::extension_popup_launch_data(
            &app.state::<crate::extensions::ExtensionRuntime>().0,
            name,
        )?
    } else {
        if program["launchable"] != true {
            return Err("This program is not migrated to Tauri yet".to_string());
        }
        let icon = program_icon(&project_root, category, name)?;
        if category == "componentapps" {
            json!({
                "kind": "componentapp",
                "name": name,
                "icon": icon,
                "appPath": PathBuf::from("omniscience")
                    .join(category)
                    .join(name)
                    .join("index.html"),
                "themeSettings": current_theme_settings(&app)?,
            })
        } else if category == "webapps" {
            let health = call_node(Arc::clone(&state.0), "health".to_string(), json!({})).await?;
            let file_server_url = health
                .get("fileServerUrl")
                .and_then(Value::as_str)
                .ok_or_else(|| "Local app server is unavailable".to_string())?;
            json!({
                "kind": "webapp",
                "name": name,
                "url": format!(
                    "{}/{}/{}/index.html",
                    file_server_url.trim_end_matches('/'),
                    category,
                    encode_uri_component(name),
                ),
                "icon": icon,
            })
        } else {
            return Err("This program cannot be opened as a window".to_string());
        }
    };
    let name = result
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "Program launch data has no program name".to_string())?;
    let icon = result
        .get("icon")
        .and_then(Value::as_str)
        .map(str::to_string);
    let window_id = PROGRAM_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let kind = result
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "Program launch data has no program type".to_string())?;

    let (label, builder) = if kind == "componentapp" {
        let app_path = result
            .get("appPath")
            .and_then(Value::as_str)
            .ok_or_else(|| "Program launch data has no componentapp path".to_string())?;
        let theme_settings = result
            .get("themeSettings")
            .ok_or_else(|| "Node.js sidecar returned no theme settings".to_string())?;
        let script =
            component_app_init_script(name, &params, theme_settings, name == "windows-settings")?;
        let is_power_menu = name == "power-menu";
        let label = format!("component-{window_id}");

        let builder = WebviewWindowBuilder::new(
            &app,
            label.clone(),
            WebviewUrl::App(PathBuf::from(app_path)),
        )
        .title(name)
        .devtools(true)
        .effects(window_backdrop_effects())
        .initialization_script(script)
        .on_new_window(popup_window_handler(app.clone()));

        let builder = if is_power_menu {
            configure_overlay_builder(builder, below_panel_bounds(*geometry)).focused(true)
        } else {
            let (width, height) = match name {
                "windows-settings" => (1120.0, 800.0),
                "settings" => (800.0, 640.0),
                "open-windows" => (1000.0, 720.0),
                _ => (400.0, 190.0),
            };
            builder
                .inner_size(width, height)
                .decorations(false)
                .transparent(true)
        };
        (label, builder)
    } else {
        let is_extension_popup = kind == "extension_popup";
        let webview_url = if is_extension_popup {
            let app_path = result
                .get("appPath")
                .and_then(Value::as_str)
                .ok_or_else(|| "Node.js sidecar returned no extension popup path".to_string())?;
            WebviewUrl::App(PathBuf::from(app_path))
        } else {
            let url = result
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "Program launch data has no program URL".to_string())?
                .parse()
                .map_err(|error| format!("Program launch data has an invalid URL: {error}"))?;
            WebviewUrl::External(url)
        };
        let label = if is_extension_popup {
            format!("program-extension-{window_id}")
        } else {
            format!("program-{window_id}")
        };
        let theme_settings = current_theme_settings(&app)?;
        let target = if kind == "extension_popup" {
            "extensions"
        } else {
            "webapps"
        };
        let initialization_script = window_chrome_initialization_script(&theme_settings, target)?;
        let width = result
            .get("width")
            .and_then(Value::as_f64)
            .unwrap_or(1000.0);
        let height = result
            .get("height")
            .and_then(Value::as_f64)
            .unwrap_or(720.0);
        let builder = WebviewWindowBuilder::new(&app, label.clone(), webview_url)
            .title(name)
            .devtools(true)
            .inner_size(width, height)
            .decorations(false)
            .transparent(true)
            .effects(window_backdrop_effects())
            .initialization_script(initialization_script)
            .on_new_window(popup_window_handler(app.clone()));
        (label, builder)
    };

    let window = builder
        .build()
        .map_err(|error| format!("Could not open {label}: {error}"))?;
    if let Some(icon) = icon {
        app.state::<ProgramWindowIcons>()
            .0
            .lock()
            .map_err(|_| "Program window icon state is unavailable".to_string())?
            .insert(label.clone(), icon);
    }
    let app_handle = app.clone();
    let window_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(icons) = app_handle.try_state::<ProgramWindowIcons>() {
                if let Ok(mut icons) = icons.0.lock() {
                    icons.remove(&window_label);
                }
            }
        }
        if matches!(event, WindowEvent::Destroyed | WindowEvent::Focused(_)) {
            let _ = app_handle.emit("managed-windows-changed", ());
        }
    });
    app.emit("managed-windows-changed", ())
        .map_err(|error| format!("Could not notify the workspace: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod popup_tests {
    use super::is_supported_popup_url;

    #[test]
    fn popup_url_support_is_limited_to_web_pages_and_blank_documents() {
        for url in [
            "https://example.com/login",
            "http://example.com/login",
            "about:blank",
            "about:blank#dialog",
        ] {
            assert!(is_supported_popup_url(&url.parse().unwrap()), "{url}");
        }

        for url in [
            "file:///C:/private.txt",
            "javascript:alert(1)",
            "tauri://localhost/index.html",
        ] {
            assert!(!is_supported_popup_url(&url.parse().unwrap()), "{url}");
        }
    }
}
