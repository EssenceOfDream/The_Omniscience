use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::{
    extensions::EXTENSION_INIT_SCRIPT,
    state::ThemeSettingsState,
};

pub(crate) fn default_theme_settings() -> Value {
    json!({
        "enabled": true,
        "maxR": 128,
        "maxG": 0,
        "maxB": 128,
        "targetAlpha": 0.25,
        "textBrightness": 255,
        "blurShadow": 8,
        "shadowColor": "#ff00ff",
    })
}

pub(crate) fn normalize_theme_settings(value: &Value) -> Result<Value, String> {
    let settings = value
        .as_object()
        .ok_or_else(|| "Invalid Omni Theme settings".to_string())?;
    let defaults = default_theme_settings();
    let default_object = defaults.as_object().expect("theme defaults are an object");
    let get_number = |key: &str| {
        let value = settings
            .get(key)
            .or_else(|| default_object.get(key))
            .ok_or_else(|| "Invalid Omni Theme settings".to_string())?;
        if value.as_f64().filter(|value| value.is_finite()).is_none() {
            return Err("Invalid Omni Theme settings".to_string());
        }
        Ok(value.clone())
    };
    let enabled = settings
        .get("enabled")
        .or_else(|| default_object.get("enabled"))
        .and_then(Value::as_bool)
        .ok_or_else(|| "Invalid Omni Theme settings".to_string())?;
    let max_r = get_number("maxR")?;
    let max_g = get_number("maxG")?;
    let max_b = get_number("maxB")?;
    let target_alpha = get_number("targetAlpha")?;
    let text_brightness = get_number("textBrightness")?;
    let blur_shadow = get_number("blurShadow")?;
    let max_r_number = max_r.as_f64().expect("validated numeric setting");
    let max_g_number = max_g.as_f64().expect("validated numeric setting");
    let max_b_number = max_b.as_f64().expect("validated numeric setting");
    let target_alpha_number = target_alpha.as_f64().expect("validated numeric setting");
    let text_brightness_number = text_brightness.as_f64().expect("validated numeric setting");
    let blur_shadow_number = blur_shadow.as_f64().expect("validated numeric setting");
    let shadow_color = settings
        .get("shadowColor")
        .or_else(|| default_object.get("shadowColor"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Invalid Omni Theme settings".to_string())?;
    let valid_color = shadow_color.len() == 7
        && shadow_color.starts_with('#')
        && shadow_color.as_bytes()[1..]
            .iter()
            .all(u8::is_ascii_hexdigit);

    if !(0.0..=255.0).contains(&max_r_number)
        || !(0.0..=255.0).contains(&max_g_number)
        || !(0.0..=255.0).contains(&max_b_number)
        || !(0.0..=1.0).contains(&target_alpha_number)
        || !(0.0..=255.0).contains(&text_brightness_number)
        || !(0.0..=30.0).contains(&blur_shadow_number)
        || !valid_color
    {
        return Err("Invalid Omni Theme settings".to_string());
    }

    Ok(json!({
        "enabled": enabled,
        "maxR": max_r,
        "maxG": max_g,
        "maxB": max_b,
        "targetAlpha": target_alpha,
        "textBrightness": text_brightness,
        "blurShadow": blur_shadow,
        "shadowColor": shadow_color,
    }))
}

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
    theme_state: State<'_, ThemeSettingsState>,
    settings: Value,
) -> Result<(), String> {
    let settings = normalize_theme_settings(&settings)?;
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
    use super::{normalize_theme_settings, window_chrome_initialization_script};

    #[test]
    fn theme_settings_merge_defaults_and_reject_invalid_values() {
        assert_eq!(
            normalize_theme_settings(&serde_json::json!({
                "enabled": false,
                "shadowColor": "#12aBcF",
                "unused": true,
            }))
            .unwrap(),
            serde_json::json!({
                "enabled": false,
                "maxR": 128,
                "maxG": 0,
                "maxB": 128,
                "targetAlpha": 0.25,
                "textBrightness": 255,
                "blurShadow": 8,
                "shadowColor": "#12aBcF",
            })
        );
        for invalid in [
            serde_json::json!([]),
            serde_json::json!({ "maxR": 256 }),
            serde_json::json!({ "targetAlpha": -0.1 }),
            serde_json::json!({ "shadowColor": "#12345g" }),
        ] {
            assert!(normalize_theme_settings(&invalid).is_err());
        }
    }

    #[test]
    fn popup_script_keeps_the_cyan_border_and_extension_theme_event() {
        let settings = serde_json::json!({ "enabled": true });
        let script = window_chrome_initialization_script(&settings, "extensions").unwrap();

        assert!(script.contains("__omni_settings_updated__"));
        assert!(script.contains("__omni_window_border__"));
    }
}
