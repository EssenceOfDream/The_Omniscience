pub(crate) mod componentapp;
pub(crate) mod desktop;
pub(crate) mod extensions;
pub(crate) mod node;
pub(crate) mod state;
pub(crate) mod theme;
pub(crate) mod windows;
pub(crate) mod workspace;

#[cfg(not(debug_assertions))]
pub(crate) mod embedded_runtime {
    include!(concat!(env!("OUT_DIR"), "/embedded_runtime.rs"));
}

pub(crate) mod componentapp_backends {
    include!(concat!(env!("OUT_DIR"), "/componentapp_backends.rs"));
}

#[cfg(target_os = "windows")]
pub(crate) mod windows_drag;

use serde_json::json;
use tauri::{Emitter, Manager, RunEvent, webview::PageLoadEvent};

use crate::{
    componentapp::componentapp_request,
    desktop::{get_file_icons, show_desktop_context_menu, start_file_drag, trash_path},
    extensions::{
        EXTENSION_INIT_SCRIPT, build_extension_initialization_script, extension_storage_get,
        extension_storage_set, extension_target_for_webview,
    },
    node::{NodeBridge, node_request, request_node, start_node_bridge},
    state::{
        ControlsCrossMode, DesktopContextMenuState, ProgramWindowIcons, ThemeSettingsState,
        WorkspaceGeometry,
    },
    theme::{current_theme_settings, update_theme, window_chrome_initialization_script},
    windows::{
        close_overview, get_program_window_settings, list_program_windows, manage_program_window,
        open_overview, open_program, open_program_devtools, open_window_settings,
        prepare_program_window_drag, reload_program_window, set_program_window_bounds,
        set_program_window_layer, toggle_overview,
    },
    workspace::{
        configure_workspace_windows, set_controls_cross_mode, start_native_workspace_window_setup,
        start_workspace_position_watchdog,
    },
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let mut runtime = start_node_bridge(app.handle()).map_err(std::io::Error::other)?;
            let extension_data = request_node(&mut runtime, "get-extension-runtime", json!({}))
                .map_err(std::io::Error::other)?;
            let extension_script = build_extension_initialization_script(&extension_data)
                .map_err(std::io::Error::other)?;
            let has_omni_theme = extension_data
                .as_array()
                .map(|extensions| {
                    extensions.iter().any(|extension| {
                        extension.get("id").and_then(serde_json::Value::as_str) == Some("omni-theme")
                    })
                })
                .unwrap_or(false);
            EXTENSION_INIT_SCRIPT.set(extension_script).map_err(|_| {
                std::io::Error::other("Chromium extensions were already initialized")
            })?;
            app.manage(NodeBridge(std::sync::Arc::new(std::sync::Mutex::new(runtime))));
            app.manage(ProgramWindowIcons(std::sync::Mutex::new(
                std::collections::HashMap::new(),
            )));
            app.manage(DesktopContextMenuState(std::sync::Mutex::new(
                serde_json::Value::Null,
            )));
            let theme_settings = {
                let node_bridge = app.state::<NodeBridge>();
                let mut runtime = node_bridge
                    .0
                    .lock()
                    .map_err(|_| std::io::Error::other("Node.js sidecar lock is unavailable"))?;
                let mut settings = request_node(&mut runtime, "get-theme", json!({}))
                    .map_err(std::io::Error::other)?;
                if has_omni_theme {
                    let stored_settings = request_node(
                        &mut runtime,
                        "extension-storage-get",
                        json!({ "extensionId": "omni-theme", "keys": null }),
                    )
                    .map_err(std::io::Error::other)?;
                    settings = request_node(&mut runtime, "set-theme", stored_settings)
                        .map_err(std::io::Error::other)?;
                }
                settings
            };
            app.manage(ThemeSettingsState(std::sync::Mutex::new(theme_settings)));
            app.manage(ControlsCrossMode(std::sync::Mutex::new(false)));
            let geometry = configure_workspace_windows(app).map_err(std::io::Error::other)?;
            app.manage(geometry);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            let target = extension_target_for_webview(webview.label());
            let theme_settings = match current_theme_settings(webview.app_handle()) {
                Ok(settings) => settings,
                Err(error) => {
                    eprintln!(
                        "[extensions] could not load page settings for {}: {error}",
                        webview.label()
                    );
                    return;
                }
            };
            let script = match window_chrome_initialization_script(&theme_settings, target) {
                Ok(script) => script,
                Err(error) => {
                    eprintln!(
                        "[extensions] could not prepare page initialization for {}: {error}",
                        webview.label()
                    );
                    return;
                }
            };
            if let Err(error) = webview.eval(script) {
                eprintln!(
                    "[extensions] could not initialize webview {}: {error}",
                    webview.label()
                );
            }
        })
        .on_menu_event(|app, event| {
            let Some(action) = event.id().as_ref().strip_prefix("desktop-context:") else {
                return;
            };
            let Some(state) = app.try_state::<DesktopContextMenuState>() else {
                eprintln!("[desktop] context menu state is unavailable");
                return;
            };
            let context = match state.0.lock() {
                Ok(mut context) => std::mem::replace(&mut *context, serde_json::Value::Null),
                Err(_) => {
                    eprintln!("[desktop] context menu state lock is unavailable");
                    return;
                }
            };
            if let Err(error) = app.emit_to(
                "desktop",
                "desktop-context-menu-action",
                json!({ "action": action, "context": context }),
            ) {
                eprintln!("[desktop] could not dispatch context menu action: {error}");
            }
        })
        .invoke_handler(tauri::generate_handler![
            node_request,
            extension_storage_get,
            extension_storage_set,
            set_controls_cross_mode,
            start_file_drag,
            get_file_icons,
            trash_path,
            show_desktop_context_menu,
            componentapp_request,
            toggle_overview,
            open_overview,
            close_overview,
            open_program,
            update_theme,
            list_program_windows,
            manage_program_window,
            set_program_window_bounds,
            prepare_program_window_drag,
            open_window_settings,
            get_program_window_settings,
            set_program_window_layer,
            reload_program_window,
            open_program_devtools
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if matches!(event, RunEvent::Ready) {
            let geometry = *app.state::<WorkspaceGeometry>();
            start_native_workspace_window_setup(app.clone());
            start_workspace_position_watchdog(app.clone(), geometry.taskbar_height);
        }
    });
}