use std::fs;

use serde_json::{Value, json};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::filesystem::resolve_absolute_path;

pub(super) fn open_file_path(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let path = resolve_existing_path(payload)?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    Ok(json!({ "opened": true }))
}

fn resolve_existing_path(payload: &Value) -> Result<std::path::PathBuf, String> {
    let path = resolve_absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute file path is required",
    )?;
    fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not access {}: {error}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::resolve_existing_path;
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn open_path_requires_an_existing_absolute_path() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omni-open-path-{unique}.txt"));
        fs::write(&path, "open").unwrap();

        assert_eq!(
            resolve_existing_path(&json!({ "path": path })).unwrap(),
            path
        );
        assert!(resolve_existing_path(&json!({ "path": "relative.txt" })).is_err());
        assert!(
            resolve_existing_path(&json!({
                "path": path.with_extension("missing")
            }))
            .is_err()
        );

        fs::remove_file(path).unwrap();
    }
}
