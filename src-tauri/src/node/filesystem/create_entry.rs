use std::fs::{self, OpenOptions};

use serde_json::{Value, json};

use super::{absolute_path::absolute_path, safe_entry_name::safe_entry_name};

pub(super) fn create_entry(payload: &Value, folder: bool) -> Result<Value, String> {
    let parent = absolute_path(
        payload.get("parentPath").and_then(Value::as_str),
        "An absolute directory path is required",
    )?;
    let name = safe_entry_name(payload.get("name").and_then(Value::as_str))?;
    let parent_metadata = fs::metadata(&parent)
        .map_err(|error| format!("Could not inspect {}: {error}", parent.display()))?;
    if !parent_metadata.is_dir() {
        return Err("Parent path is not a directory".to_string());
    }
    let target = parent.join(name);

    if folder {
        fs::create_dir(&target)
            .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
    } else {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
    }
    Ok(json!({ "path": target }))
}
