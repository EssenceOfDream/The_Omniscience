use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::{
    node::{NodeBridge, request_node},
    state::{
        ControlsCrossMode, WindowBounds, WorkspaceGeometry, window_backdrop_effects,
    },
    theme::{current_theme_settings, window_chrome_initialization_script},
};

const WINDOW_CONTROLS_WIDTH: f64 = 108.0;
const WINDOW_CONTROLS_HEIGHT: f64 = 62.0;
const WINDOW_CONTROLS_BOTTOM_PADDING: f64 = 0.0;

pub(crate) fn get_primary_screen_bounds(
    window: &WebviewWindow,
) -> Result<(WindowBounds, f64), String> {
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

pub(crate) fn calculate_workspace_geometry(
    screen: WindowBounds,
    taskbar_height: f64,
) -> WorkspaceGeometry {
    let is_windows = cfg!(target_os = "windows");
    let panel_height = if is_windows { 28.0 } else { WINDOW_CONTROLS_HEIGHT };
    let controls_width = WINDOW_CONTROLS_WIDTH.min(screen.width);
    let panel = if is_windows {
        WindowBounds {
            x: screen.x + controls_width - 1.0,
            y: screen.y + taskbar_height,
            width: (screen.width - controls_width + 1.0).max(1.0),
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

fn controls_bounds(geometry: WorkspaceGeometry, cross_mode: bool) -> WindowBounds {
    if cross_mode {
        geometry.controls
    } else {
        WindowBounds {
            x: geometry.controls.x,
            y: if cfg!(target_os = "windows") {
                geometry.panel.y
            } else {
                geometry.controls.y
            },
            width: geometry.controls.width,
            height: geometry.panel.height,
        }
    }
}

pub(crate) fn below_panel_bounds(geometry: WorkspaceGeometry) -> WindowBounds {
    let y = geometry.panel.y + geometry.panel.height - 1.0;
    let height = (geometry.screen.y + geometry.screen.height - y).max(1.0);
    WindowBounds {
        x: geometry.screen.x,
        y,
        width: geometry.screen.width,
        height,
    }
}

pub(crate) fn apply_window_bounds(
    window: &WebviewWindow,
    bounds: WindowBounds,
    name: &str,
) -> Result<(), String> {
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("Could not read the {name} window scale: {error}"))?;

    let inner_size = window
        .inner_size()
        .map_err(|error| format!("Could not read the {name} window size: {error}"))?
        .to_logical::<f64>(scale_factor);

    if (inner_size.width - bounds.width).abs() > 0.5
        || (inner_size.height - bounds.height).abs() > 0.5
    {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                bounds.width,
                bounds.height,
            )))
            .map_err(|error| format!("Could not size the {name} window: {error}"))?;
    }

    let outer_position = window
        .outer_position()
        .map_err(|error| format!("Could not read the {name} window position: {error}"))?
        .to_logical::<f64>(scale_factor);
    let inner_position = window
        .inner_position()
        .map_err(|error| format!("Could not read the {name} window position: {error}"))?
        .to_logical::<f64>(scale_factor);
    let target_outer_x = bounds.x - (inner_position.x - outer_position.x);
    let target_outer_y = bounds.y - (inner_position.y - outer_position.y);

    if (outer_position.x - target_outer_x).abs() > 0.5
        || (outer_position.y - target_outer_y).abs() > 0.5
    {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                target_outer_x,
                target_outer_y,
            )))
            .map_err(|error| format!("Could not position the {name} window: {error}"))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn set_windows_shell_layer(
    app: &AppHandle,
    window: &WebviewWindow,
    layer: &str,
) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| {
            format!(
                "Could not read the {} window handle: {error}",
                window.label()
            )
        })?
        .0 as usize;
    if hwnd == 0 {
        return Err(format!(
            "The {} window has an invalid handle",
            window.label()
        ));
    }

    let node_bridge = app.state::<NodeBridge>();
    let mut runtime = node_bridge
        .0
        .lock()
        .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
    let result = request_node(
        &mut runtime,
        "set-shell-window-layer",
        json!({ "hwnd": hwnd.to_string(), "layer": layer }),
    )?;
    if result.as_bool() != Some(true) {
        return Err(format!(
            "Could not place the {} window in the {layer} layer",
            window.label()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn set_windows_shell_layer(
    _app: &AppHandle,
    _window: &WebviewWindow,
    _layer: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_windows_panel_dock(app: &AppHandle, panel: &WebviewWindow) -> Result<(), String> {
    let hwnd = panel
        .hwnd()
        .map_err(|error| format!("Could not read the panel window handle: {error}"))?
        .0 as usize;
    let position = panel
        .outer_position()
        .map_err(|error| format!("Could not read the panel position: {error}"))?;
    let size = panel
        .inner_size()
        .map_err(|error| format!("Could not read the panel size: {error}"))?;
    let node_bridge = app.state::<NodeBridge>();
    let mut runtime = node_bridge
        .0
        .lock()
        .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
    let result = request_node(
        &mut runtime,
        "set-shell-panel-dock",
        json!({
            "hwnd": hwnd.to_string(),
            "x": position.x,
            "y": position.y,
            "width": size.width,
            "height": size.height,
        }),
    )?;
    if result.as_bool() != Some(true) {
        return Err("Could not reserve the workspace panel area".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_windows_panel_dock(_app: &AppHandle, _panel: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn remove_windows_panel_dock(app: &AppHandle, panel: &WebviewWindow) -> Result<(), String> {
    let hwnd = panel
        .hwnd()
        .map_err(|error| format!("Could not read the panel window handle: {error}"))?
        .0 as usize;
    let node_bridge = app.state::<NodeBridge>();
    let mut runtime = node_bridge
        .0
        .lock()
        .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
    let result = request_node(
        &mut runtime,
        "remove-shell-panel-dock",
        json!({ "hwnd": hwnd.to_string() }),
    )?;
    if result.as_bool() != Some(true) {
        return Err("Could not release the workspace panel area".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn remove_windows_panel_dock(_app: &AppHandle, _panel: &WebviewWindow) -> Result<(), String> {
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
    let controls_cross_mode = app.state::<ControlsCrossMode>();
    let cross_mode = controls_cross_mode
        .0
        .lock()
        .map_err(|_| "Window controls state lock is unavailable".to_string())?;
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
    if let Err(error) = apply_window_bounds(
        &controls,
        controls_bounds(geometry, *cross_mode),
        "window controls",
    ) {
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

pub(crate) fn start_workspace_position_watchdog(app: AppHandle, taskbar_height: f64) {
    thread::spawn(move || {
        loop {
            if app.get_webview_window("desktop").is_none() {
                break;
            }
            if let Err(error) = force_workspace_positions(&app, taskbar_height) {
                eprintln!("[workspace] failed to enforce shell window placement: {error}");
            }
            if let Some(desktop) = app.get_webview_window("desktop") {
                if let Err(error) = set_windows_shell_layer(&app, &desktop, "desktop") {
                    eprintln!("[workspace] failed to keep the desktop behind Explorer: {error}");
                }
            }
            if let Some(controls) = app.get_webview_window("controls") {
                if let Err(error) = set_windows_shell_layer(&app, &controls, "top") {
                    eprintln!("[workspace] failed to keep the window controls on top: {error}");
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

pub(crate) fn start_native_workspace_window_setup(app: AppHandle) {
    thread::spawn(move || {
        let result = (|| {
            let desktop = app
                .get_webview_window("desktop")
                .ok_or_else(|| "The desktop window was not created".to_string())?;
            let panel = app
                .get_webview_window("panel")
                .ok_or_else(|| "The workspace panel was not created".to_string())?;
            let controls = app
                .get_webview_window("controls")
                .ok_or_else(|| "The window controls were not created".to_string())?;

            set_windows_shell_layer(&app, &desktop, "desktop")?;
            set_windows_shell_layer(&app, &panel, "top")?;
            set_windows_shell_layer(&app, &controls, "top")?;
            set_windows_panel_dock(&app, &panel)
        })();
        if let Err(error) = result {
            eprintln!("[workspace] failed to initialize native window layers: {error}");
        }
    });
}

fn schedule_desktop_bottom(app: &AppHandle, desktop: &WebviewWindow) {
    let app = app.clone();
    let desktop = desktop.clone();
    thread::spawn(move || {
        if let Err(error) = set_windows_shell_layer(&app, &desktop, "desktop") {
            eprintln!("[workspace] failed to keep the desktop behind Explorer: {error}");
        }
    });
}

fn close_workspace_on_window_close(
    window: &WebviewWindow,
    app: AppHandle,
    panel: &WebviewWindow,
    close_started: Arc<AtomicBool>,
) {
    let panel = panel.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if close_started.swap(true, Ordering::SeqCst) {
                return;
            }
            let app = app.clone();
            let panel = panel.clone();
            thread::spawn(move || {
                if let Err(error) = remove_windows_panel_dock(&app, &panel) {
                    eprintln!("[workspace] failed to release panel work area: {error}");
                }
                app.exit(0);
            });
        }
    });
}

pub(crate) fn configure_workspace_windows(
    app: &mut tauri::App,
) -> Result<WorkspaceGeometry, String> {
    let desktop = app
        .get_webview_window("desktop")
        .ok_or_else(|| "The desktop window was not created".to_string())?;
    let (screen, scale_factor) = get_primary_screen_bounds(&desktop)?;
    let theme_settings = current_theme_settings(app.handle())?;
    let initialization_script = window_chrome_initialization_script(&theme_settings, "shell")?;
    desktop
        .eval(&initialization_script)
        .map_err(|error| format!("Could not apply Omni Theme to the desktop: {error}"))?;

    let node_bridge = app.state::<NodeBridge>();
    let mut runtime = node_bridge
        .0
        .lock()
        .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
    #[cfg(target_os = "windows")]
    let taskbar_height = workspace_taskbar_height(
        request_node(&mut runtime, "explorer-shell-status", json!({})),
        scale_factor,
    );
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
            .devtools(true)
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
            .focused(false)
            .visible(false)
            .initialization_script(initialization_script.clone())
            .effects(window_backdrop_effects())
            .build()
            .map_err(|error| format!("Could not create the workspace panel: {error}"))?;

    let initial_controls_bounds = controls_bounds(geometry, false);
    let controls = WebviewWindowBuilder::new(
        app,
        "controls",
        WebviewUrl::App(PathBuf::from("controls.html")),
    )
    .title("Omniscience window controls")
    .devtools(true)
    .position(initial_controls_bounds.x, initial_controls_bounds.y)
    .inner_size(
        initial_controls_bounds.width,
        initial_controls_bounds.height,
    )
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
    .initialization_script(initialization_script)
    .effects(window_backdrop_effects())
    .build()
    .map_err(|error| format!("Could not create the window controls: {error}"))?;

    let app_handle = app.handle().clone();
    let close_started = Arc::new(AtomicBool::new(false));
    close_workspace_on_window_close(&desktop, app_handle.clone(), &panel, close_started.clone());
    close_workspace_on_window_close(&panel, app_handle.clone(), &panel, close_started.clone());
    close_workspace_on_window_close(&controls, app_handle, &panel, close_started);

    let app_for_focus = app.handle().clone();
    let desktop_for_focus = desktop.clone();
    desktop.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(true)) {
            schedule_desktop_bottom(&app_for_focus, &desktop_for_focus);
        }
    });

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

#[cfg(target_os = "windows")]
pub(crate) fn workspace_taskbar_height(status: Result<Value, String>, scale_factor: f64) -> f64 {
    let height = status.and_then(|status| {
        status
            .get("taskbarBounds")
            .and_then(|bounds| bounds.get("height"))
            .and_then(Value::as_f64)
            .filter(|height| *height > 0.0)
            .ok_or_else(|| "Windows did not report the primary taskbar bounds".to_string())
    });

    match height {
        Ok(height) if scale_factor.is_finite() && scale_factor > 0.0 => height / scale_factor,
        Ok(_) => {
            eprintln!("[workspace] invalid monitor scale factor; using zero taskbar offset");
            0.0
        }
        Err(error) => {
            eprintln!(
                "[workspace] could not read Explorer taskbar bounds; using zero taskbar offset: {error}"
            );
            0.0
        }
    }
}

#[tauri::command]
pub(crate) fn set_controls_cross_mode(
    app: AppHandle,
    geometry: State<'_, WorkspaceGeometry>,
    controls_cross_mode: State<'_, ControlsCrossMode>,
    cross_mode: bool,
) -> Result<(), String> {
    let mut current = controls_cross_mode
        .0
        .lock()
        .map_err(|_| "Window controls state lock is unavailable".to_string())?;
    let window = app
        .get_webview_window("controls")
        .ok_or_else(|| "The window controls were not created".to_string())?;
    apply_window_bounds(
        &window,
        controls_bounds(*geometry, cross_mode),
        "window controls",
    )?;
    *current = cross_mode;
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod workspace_tests {
    use super::workspace_taskbar_height;
    use serde_json::json;

    #[test]
    fn taskbar_status_failures_do_not_prevent_workspace_startup() {
        assert_eq!(
            workspace_taskbar_height(
                Ok(json!({ "taskbarBounds": { "height": 40.0 } })),
                2.0,
            ),
            20.0
        );
        assert_eq!(
            workspace_taskbar_height(Err("native request timed out".to_string()), 2.0),
            0.0
        );
        assert_eq!(workspace_taskbar_height(Ok(json!({})), 2.0), 0.0);
    }
}
