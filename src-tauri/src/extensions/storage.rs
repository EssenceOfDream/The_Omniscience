use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value, json};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::state::ThemeSettingsState;

use super::validate_extension_storage_window;

fn storage_directory() -> Result<PathBuf, String> {
    if let Some(app_data) = std::env::var_os("APPDATA").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(app_data)
            .join("The_Omniscience")
            .join("extensions"));
    }

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| {
            "Could not resolve the user home directory for extension storage".to_string()
        })?;
    Ok(PathBuf::from(home)
        .join(".the-omniscience")
        .join("extensions"))
}

fn validate_extension_id(extension_id: &str) -> Result<(), String> {
    if extension_id.is_empty()
        || extension_id.starts_with('.')
        || extension_id
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return Err("Invalid extension id".to_string());
    }
    Ok(())
}

fn validate_extension_manifest(extension_root: &Path, extension_id: &str) -> Result<(), String> {
    validate_extension_id(extension_id)?;
    let manifest_path = extension_root
        .join("extensions")
        .join(extension_id)
        .join("manifest.json");
    let metadata = fs::symlink_metadata(&manifest_path)
        .map_err(|error| format!("Could not read extension {extension_id} manifest: {error}"))?;
    if !metadata.file_type().is_file() {
        return Err(format!(
            "Extension {extension_id} manifest is not a regular file"
        ));
    }
    let manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            format!("Could not read extension {extension_id} manifest: {error}")
        })?)
        .map_err(|error| format!("Could not parse extension {extension_id} manifest: {error}"))?;
    if manifest.get("manifest_version").and_then(Value::as_u64) != Some(3)
        || manifest
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .is_none()
        || manifest
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .is_none()
    {
        return Err(format!(
            "Extension {extension_id} must have a valid Manifest V3 manifest"
        ));
    }
    Ok(())
}

fn storage_file(storage_root: &Path, extension_id: &str) -> Result<PathBuf, String> {
    validate_extension_id(extension_id)?;
    Ok(storage_root.join(format!("{extension_id}.json")))
}

fn read_values(
    extension_root: &Path,
    storage_root: &Path,
    extension_id: &str,
) -> Result<Value, String> {
    validate_extension_manifest(extension_root, extension_id)?;
    let file = storage_file(storage_root, extension_id)?;
    let contents = match fs::read(&file) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(Map::new()));
        }
        Err(error) => {
            return Err(format!(
                "Could not read storage for extension {extension_id}: {error}"
            ));
        }
    };
    let values: Value = serde_json::from_slice(&contents)
        .map_err(|error| format!("Invalid stored data for extension {extension_id}: {error}"))?;
    if !values.is_object() {
        return Err(format!("Invalid stored data for extension {extension_id}"));
    }
    Ok(values)
}

fn property_key(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| match value {
                Value::Null => String::new(),
                value => property_key(value),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

fn select_values(values: &Value, keys: Option<&Value>) -> Result<Value, String> {
    let source = values
        .as_object()
        .ok_or_else(|| "Extension storage values must be an object".to_string())?;
    let mut selected = Map::new();
    match keys {
        None | Some(Value::Null) => return Ok(values.clone()),
        Some(Value::String(key)) => {
            if let Some(value) = source.get(key) {
                selected.insert(key.clone(), value.clone());
            }
        }
        Some(Value::Array(keys)) => {
            for key in keys {
                let key = property_key(key);
                if let Some(value) = source.get(&key) {
                    selected.insert(key, value.clone());
                }
            }
        }
        Some(Value::Object(keys)) => {
            for (key, fallback) in keys {
                selected.insert(key.clone(), source.get(key).unwrap_or(fallback).clone());
            }
        }
        Some(_) => return Err("Invalid extension storage keys".to_string()),
    }
    Ok(Value::Object(selected))
}

fn write_values(
    extension_root: &Path,
    storage_root: &Path,
    extension_id: &str,
    items: Value,
    remove_keys: Vec<String>,
    clear: bool,
) -> Result<(Value, Value), String> {
    if !items.is_object() {
        return Err("Extension storage items must be an object".to_string());
    }
    let old_values = read_values(extension_root, storage_root, extension_id)?;
    let old_object = old_values
        .as_object()
        .ok_or_else(|| format!("Invalid stored data for extension {extension_id}"))?;
    let item_object = items
        .as_object()
        .ok_or_else(|| "Extension storage items must be an object".to_string())?;
    let mut new_values = if clear {
        Map::new()
    } else {
        old_object.clone()
    };
    if !clear {
        new_values.extend(item_object.clone());
    }
    for key in &remove_keys {
        new_values.remove(key);
    }

    let mut changed_keys = BTreeSet::new();
    changed_keys.extend(item_object.keys().cloned());
    changed_keys.extend(remove_keys);
    if clear {
        changed_keys.extend(old_object.keys().cloned());
    }

    let mut changes = Map::new();
    for key in changed_keys {
        let old_value = old_object.get(&key);
        let new_value = new_values.get(&key);
        if old_value == new_value {
            continue;
        }
        let mut change = Map::new();
        if let Some(value) = new_value {
            change.insert("newValue".to_string(), value.clone());
        }
        if let Some(value) = old_value {
            change.insert("oldValue".to_string(), value.clone());
        }
        changes.insert(key, Value::Object(change));
    }

    let storage_file = storage_file(storage_root, extension_id)?;
    fs::create_dir_all(storage_root)
        .map_err(|error| format!("Could not create extension storage directory: {error}"))?;
    let serialized = serde_json::to_vec(&Value::Object(new_values.clone()))
        .map_err(|error| format!("Could not encode extension storage: {error}"))?;
    fs::write(&storage_file, serialized).map_err(|error| {
        format!("Could not write storage for extension {extension_id}: {error}")
    })?;
    Ok((Value::Object(changes), Value::Object(new_values)))
}

pub(crate) fn read_extension_storage_for_app(
    app: &AppHandle,
    extension_id: &str,
) -> Result<Value, String> {
    let extension_root = crate::node::runtime_root(app)?;
    let storage_root = storage_directory()?;
    read_values(&extension_root, &storage_root, extension_id)
}

#[tauri::command]
pub(crate) async fn extension_storage_get(
    app: AppHandle,
    window: WebviewWindow,
    extension_id: String,
    keys: Option<Value>,
) -> Result<Value, String> {
    validate_extension_storage_window(&window, &extension_id)?;
    let extension_root = crate::node::runtime_root(&app)?;
    let storage_root = storage_directory()?;
    tauri::async_runtime::spawn_blocking(move || {
        let values = read_values(&extension_root, &storage_root, &extension_id)?;
        select_values(&values, keys.as_ref())
    })
    .await
    .map_err(|error| format!("Extension storage read task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn extension_storage_set(
    app: AppHandle,
    window: WebviewWindow,
    theme_state: State<'_, ThemeSettingsState>,
    extension_id: String,
    items: Value,
    remove_keys: Option<Vec<String>>,
    clear: Option<bool>,
) -> Result<(), String> {
    validate_extension_storage_window(&window, &extension_id)?;
    let extension_root = crate::node::runtime_root(&app)?;
    let storage_root = storage_directory()?;
    let id = extension_id.clone();
    let (changes, stored_values) = tauri::async_runtime::spawn_blocking(move || {
        write_values(
            &extension_root,
            &storage_root,
            &id,
            items,
            remove_keys.unwrap_or_default(),
            clear.unwrap_or(false),
        )
    })
    .await
    .map_err(|error| format!("Extension storage write task failed: {error}"))??;

    if extension_id == "omni-theme" {
        let settings = crate::theme::normalize_theme_settings(&stored_values)?;
        *theme_state
            .0
            .lock()
            .map_err(|_| "Omni Theme settings lock is unavailable".to_string())? = settings;
    }

    let payload = json!({ "extensionId": extension_id, "changes": changes });
    app.emit("extension-storage-changed", payload.clone())
        .map_err(|error| format!("Could not notify extensions about storage changes: {error}"))?;
    let payload = serde_json::to_string(&payload)
        .map_err(|error| format!("Could not encode extension storage changes: {error}"))?;
    let script = format!(
        "window.dispatchEvent(new CustomEvent('__omniscience_extension_storage_changed__',{{detail:{payload}}}));"
    );
    for (label, popup) in app.webview_windows() {
        if label.starts_with("program-") {
            if let Err(error) = popup.eval(&script) {
                eprintln!(
                    "[extensions] could not notify program window {label} about storage changes: {error}"
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{select_values, validate_extension_id, write_values};
    use serde_json::{Value, json};
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn extension_storage_preserves_get_fallback_and_set_remove_clear_semantics() {
        let root = std::env::temp_dir().join(format!(
            "omni-rust-extension-storage-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed),
        ));
        let extension_root = root.join("project");
        let storage_root = root.join("storage");
        let extension = extension_root.join("extensions").join("sample");
        fs::create_dir_all(&extension).unwrap();
        fs::write(
            extension.join("manifest.json"),
            r#"{"manifest_version":3,"name":"Sample","version":"1"}"#,
        )
        .unwrap();

        let (changes, values) = write_values(
            &extension_root,
            &storage_root,
            "sample",
            json!({"enabled": true, "count": 2}),
            Vec::new(),
            false,
        )
        .unwrap();
        assert_eq!(
            changes,
            json!({
                "enabled": {"newValue": true},
                "count": {"newValue": 2}
            })
        );
        assert_eq!(
            select_values(
                &values,
                Some(&json!({"enabled": false, "missing": "default"}))
            )
            .unwrap(),
            json!({"enabled": true, "missing": "default"})
        );

        let (changes, values) = write_values(
            &extension_root,
            &storage_root,
            "sample",
            json!({"count": 3}),
            vec!["enabled".to_string()],
            false,
        )
        .unwrap();
        assert_eq!(
            changes,
            json!({
                "enabled": {"oldValue": true},
                "count": {"newValue": 3, "oldValue": 2}
            })
        );
        assert_eq!(values, json!({"count": 3}));

        let (changes, values) = write_values(
            &extension_root,
            &storage_root,
            "sample",
            json!({}),
            Vec::new(),
            true,
        )
        .unwrap();
        assert_eq!(changes, json!({"count": {"oldValue": 3}}));
        assert_eq!(values, json!({}));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extension_storage_rejects_unsafe_ids_and_invalid_keys() {
        for id in ["", ".", "..", "../secret", "a\\b", "bad:name"] {
            assert!(validate_extension_id(id).is_err(), "{id}");
        }
        assert!(select_values(&json!({}), Some(&Value::Bool(true))).is_err());
    }
}
