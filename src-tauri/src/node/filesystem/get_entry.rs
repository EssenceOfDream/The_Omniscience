use std::{fs, path::Path, time::UNIX_EPOCH};

use serde_json::{Value, json};

pub(super) fn get_entry(path: &Path, name: &str) -> Result<Value, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_dir() {
        "directory"
    } else if file_type.is_file() {
        "file"
    } else if file_type.is_symlink() {
        "symlink"
    } else {
        "other"
    };
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(json!({
        "name": name,
        "path": path,
        "kind": kind,
        "size": metadata.len(),
        "modifiedAt": modified_at,
    }))
}
