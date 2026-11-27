use serde_json::{Value, json};

use super::absolute_path::absolute_path;

pub(super) fn parent_directory(payload: &Value) -> Result<Value, String> {
    let path = absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute directory path is required",
    )?;
    let parent = path.parent().unwrap_or(&path);
    Ok(json!(parent))
}
