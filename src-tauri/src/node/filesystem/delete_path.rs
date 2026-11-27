use std::fs;

use serde_json::{Value, json};

use super::absolute_path::absolute_path;

pub(super) fn delete_path(payload: &Value) -> Result<Value, String> {
    let path = absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute file path is required",
    )?;
    if path.file_name().is_none() {
        return Err("Cannot delete a filesystem root".to_string());
    }

    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path)
    } else {
        fs::remove_file(&path)
    }
    .map_err(|error| format!("Could not delete {}: {error}", path.display()))?;
    Ok(json!({ "success": true }))
}
