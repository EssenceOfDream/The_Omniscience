use std::fs;

use serde_json::{Value, json};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::filesystem::resolve_absolute_path;

pub(super) fn reveal_file_path(app: &AppHandle, payload: &Value) -> Result<Value, String> {
    let directory = resolve_reveal_directory(payload)?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| format!("Could not open {}: {error}", directory.display()))?;
    Ok(json!({ "opened": true }))
}

fn resolve_reveal_directory(payload: &Value) -> Result<std::path::PathBuf, String> {
    let path = resolve_absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute file path is required",
    )?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not access {}: {error}", path.display()))?;
    if metadata.is_dir() {
        return Ok(path);
    }
    path.parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "Could not determine the parent directory for {}",
                path.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::resolve_reveal_directory;
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn reveal_path_opens_the_directory_or_file_parent() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("omni-reveal-path-{unique}"));
        fs::create_dir(&directory).unwrap();
        let file_path = directory.join("sample.txt");
        fs::write(&file_path, "reveal").unwrap();

        assert_eq!(
            resolve_reveal_directory(&json!({ "path": directory })).unwrap(),
            directory
        );
        assert_eq!(
            resolve_reveal_directory(&json!({ "path": file_path })).unwrap(),
            directory
        );
        assert!(resolve_reveal_directory(&json!({ "path": "relative.txt" })).is_err());

        fs::remove_dir_all(directory).unwrap();
    }
}
