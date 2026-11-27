use std::fs;

use serde_json::{Value, json};

use super::{absolute_path::absolute_path, safe_entry_name::safe_entry_name};

pub(super) fn rename_entry(payload: &Value) -> Result<Value, String> {
    let source = absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute source path is required",
    )?;
    let name = safe_entry_name(payload.get("name").and_then(Value::as_str))?;
    let parent = source
        .parent()
        .ok_or_else(|| "An absolute source path is required".to_string())?;
    let target = parent.join(name);
    if source == target {
        return Ok(json!({ "path": source }));
    }
    if fs::symlink_metadata(&target).is_ok() {
        return Err(format!("EEXIST: {} already exists", target.display()));
    }
    fs::rename(&source, &target).map_err(|error| {
        format!(
            "Could not rename {} to {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    Ok(json!({ "path": target }))
}
