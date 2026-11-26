use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::{
    extensions::EXTENSION_INIT_SCRIPT,
    node::{NodeBridge, call_node},
    state::ThemeSettingsState,
};

pub(crate) fn current_theme_settings(app: &AppHandle) -> Result<Value, String> {
    app.state::<ThemeSettingsState>()
        .0
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| "Omni Theme settings lock is unavailable".to_string())
}

pub(crate) fn window_chrome_initialization_script(
    theme_settings: &Value,
    target: &str,
) -> Result<String, String> {
    let settings = serde_json::to_string(theme_settings)
        .map_err(|error| format!("Could not encode Omni Theme settings: {error}"))?;

    let mut script = String::from("(()=>{const settings=");
    script.push_str(&settings);
    script.push_str(
        ";try{localStorage.setItem('__omni_settings__',JSON.stringify(settings));}catch(_){}\
         const install=()=>{const root=document.documentElement;if(!root)return false;\
         if(!document.getElementById('__omni_window_border__')){const border=document.createElement('div');\
         border.id='__omni_window_border__';border.setAttribute('aria-hidden','true');\
         Object.assign(border.style,{position:'fixed',inset:'0',border:'1px dashed #00ffff',\
         boxSizing:'border-box',pointerEvents:'none',zIndex:'2147483647'});root.appendChild(border);}\
         return true;};if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect();});\
         observer.observe(document,{childList:true,subtree:true});}\
         window.dispatchEvent(new CustomEvent('__omni_settings_updated__',{detail:settings}));})();",
    );
    if let Some(extension_script) = EXTENSION_INIT_SCRIPT.get() {
        let target = serde_json::to_string(target)
            .map_err(|error| format!("Could not encode extension target: {error}"))?;
        script.push_str(&extension_script.replacen("__OMNI_TARGET__", &target, 1));
    }
    Ok(script)
}

#[tauri::command]
pub(crate) async fn update_theme(
    app: AppHandle,
    state: State<'_, NodeBridge>,
    theme_state: State<'_, ThemeSettingsState>,
    settings: Value,
) -> Result<(), String> {
    let settings = call_node(Arc::clone(&state.0), "set-theme".to_string(), settings).await?;
    *theme_state
        .0
        .lock()
        .map_err(|_| "Omni Theme settings lock is unavailable".to_string())? = settings.clone();
    let serialized_settings = serde_json::to_string(&settings)
        .map_err(|error| format!("Could not encode Omni Theme settings: {error}"))?;
    let script = format!(
        "(()=>{{const settings={serialized_settings};try{{localStorage.setItem('__omni_settings__',JSON.stringify(settings));}}catch(_){{}}window.dispatchEvent(new CustomEvent('__omni_settings_updated__',{{detail:settings}}));}})();"
    );

    let mut errors = Vec::new();
    for (label, window) in app.webview_windows() {
        if let Err(error) = window.eval(&script) {
            errors.push(format!("{label}: {error}"));
        }
    }
    if !errors.is_empty() {
        return Err(format!(
            "Could not update Omni Theme in all windows: {}",
            errors.join("; ")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::window_chrome_initialization_script;

    #[test]
    fn popup_script_keeps_the_cyan_border_and_extension_theme_event() {
        let settings = serde_json::json!({ "enabled": true });
        let script = window_chrome_initialization_script(&settings, "extensions").unwrap();

        assert!(script.contains("__omni_settings_updated__"));
        assert!(script.contains("__omni_window_border__"));
    }
}