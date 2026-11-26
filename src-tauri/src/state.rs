use std::collections::HashMap;
use std::sync::{Mutex};

use serde_json::Value;
use tauri::utils::config::WindowEffectsConfig;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedProgramWindow {
    pub(crate) label: String,
    pub(crate) title: String,
    pub(crate) icon: Option<String>,
    pub(crate) minimized: bool,
    pub(crate) focused: bool,
    pub(crate) maximized: bool,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramWindowSettings {
    pub(crate) label: String,
    pub(crate) title: String,
    pub(crate) always_on_top: bool,
}

pub(crate) struct ProgramWindowIcons(pub(crate) Mutex<HashMap<String, String>>);

pub(crate) struct ThemeSettingsState(pub(crate) Mutex<Value>);

pub(crate) struct DesktopContextMenuState(pub(crate) Mutex<Value>);

pub(crate) struct ControlsCrossMode(pub(crate) Mutex<bool>);

#[derive(Clone, Copy)]
pub(crate) struct WindowBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Copy)]
pub(crate) struct WorkspaceGeometry {
    pub(crate) screen: WindowBounds,
    pub(crate) panel: WindowBounds,
    pub(crate) controls: WindowBounds,
    pub(crate) taskbar_height: f64,
}

pub(crate) fn window_backdrop_effects() -> WindowEffectsConfig {
    let effects = tauri::window::EffectsBuilder::new();
    #[cfg(target_os = "windows")]
    let effects = effects.effect(tauri::window::Effect::Acrylic);
    #[cfg(target_os = "macos")]
    let effects = effects.effect(tauri::window::Effect::HudWindow);
    effects.build()
}