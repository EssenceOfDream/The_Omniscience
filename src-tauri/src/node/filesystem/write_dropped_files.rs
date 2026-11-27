use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value, json};

use super::absolute_path::absolute_path;

static GENERATED_NAME_ID: AtomicU64 = AtomicU64::new(0);

pub(super) fn write_dropped_files(payload: &Value) -> Result<Value, String> {
    let directory = absolute_path(
        payload.get("dir").and_then(Value::as_str),
        "An absolute directory path is required",
    )?;
    let metadata = fs::metadata(&directory)
        .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
    if !metadata.is_dir() {
        return Err("Drop destination is not a directory".to_string());
    }

    let files = payload
        .get("files")
        .and_then(Value::as_array)
        .filter(|files| !files.is_empty())
        .ok_or_else(|| "At least one dropped file is required".to_string())?;
    let results = files
        .iter()
        .map(|file| write_one_file(&directory, file))
        .collect::<Vec<_>>();
    let all_succeeded = results
        .iter()
        .all(|result| result.get("success").and_then(Value::as_bool) == Some(true));

    Ok(json!({
        "success": all_succeeded,
        "results": results,
    }))
}

fn write_one_file(directory: &Path, file: &Value) -> Value {
    let original_name = file.get("name").and_then(Value::as_str).unwrap_or("");
    let name = match sanitized_name(original_name) {
        Ok(name) => name,
        Err(error) => {
            return json!({
                "name": original_name,
                "success": false,
                "error": error,
            });
        }
    };
    let bytes = match file.get("data").and_then(bytes_from_value) {
        Some(bytes) => bytes,
        None => {
            return json!({
                "name": original_name,
                "success": false,
                "error": "Dropped file data is invalid",
            });
        }
    };

    match create_unique_file(directory, &name, &bytes) {
        Ok(destination) => json!({
            "name": name,
            "destination": destination.to_string_lossy(),
            "success": true,
        }),
        Err(error) => json!({
            "name": original_name,
            "success": false,
            "error": error,
        }),
    }
}

fn sanitized_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let sanitized = if trimmed.is_empty() {
        generated_name()
    } else {
        trimmed
            .chars()
            .map(|character| {
                if matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                ) || character <= '\u{1f}'
                {
                    '_'
                } else {
                    character
                }
            })
            .collect()
    };
    if sanitized == "." || sanitized == ".." {
        return Err("Dropped file name is invalid".to_string());
    }
    Ok(sanitized)
}

fn generated_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let id = GENERATED_NAME_ID.fetch_add(1, Ordering::Relaxed);
    format!("dropped-{}-{timestamp}-{id}.bin", std::process::id())
}

fn bytes_from_value(value: &Value) -> Option<Vec<u8>> {
    match value {
        Value::Array(values) => values.iter().map(byte_from_value).collect(),
        Value::Object(values) => object_bytes(values),
        _ => None,
    }
}

fn byte_from_value(value: &Value) -> Option<u8> {
    value.as_u64().and_then(|value| u8::try_from(value).ok())
}

fn object_bytes(values: &Map<String, Value>) -> Option<Vec<u8>> {
    let mut indexed_values = values
        .iter()
        .filter_map(|(key, value)| {
            if key.is_empty() || !key.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            key.parse::<u64>().ok().map(|index| (index, value))
        })
        .collect::<Vec<_>>();
    indexed_values.sort_by_key(|(index, _)| *index);
    indexed_values
        .into_iter()
        .map(|(_, value)| byte_from_value(value))
        .collect()
}

fn create_unique_file(directory: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let mut suffix = 0u64;
    loop {
        let candidate_name = if suffix == 0 {
            name.to_string()
        } else {
            suffixed_name(name, suffix)
        };
        let destination = directory.join(candidate_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    drop(file);
                    if let Err(cleanup_error) = fs::remove_file(&destination) {
                        eprintln!(
                            "[filesystem] could not remove incomplete dropped file {}: {cleanup_error}",
                            destination.display()
                        );
                    }
                    return Err(format!(
                        "Could not write {}: {error}",
                        destination.display()
                    ));
                }
                return Ok(destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                suffix = suffix
                    .checked_add(1)
                    .ok_or_else(|| "Could not choose an unused dropped-file name".to_string())?;
            }
            Err(error) => {
                return Err(format!(
                    "Could not create {}: {error}",
                    destination.display()
                ));
            }
        }
    }
}

fn suffixed_name(name: &str, suffix: u64) -> String {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    format!("{stem} ({suffix}){extension}")
}

#[cfg(test)]
mod tests {
    use super::write_dropped_files;
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn writes_dropped_bytes_without_overwriting_and_reports_per_file_errors() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("omni-inline-drop-{unique}"));
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("sample.txt"), "existing").unwrap();

        let result = write_dropped_files(&json!({
            "dir": directory,
            "files": [
                { "name": "sample.txt", "data": [105, 110, 108, 105, 110, 101] },
                { "name": "bad?.bin", "data": { "1": 66, "0": 65, "meta": 3 } },
                { "name": ".", "data": [1] },
                { "name": "invalid.bin", "data": [256] },
            ],
        }))
        .unwrap();

        assert_eq!(result["success"], false);
        assert_eq!(result["results"][0]["name"], "sample.txt");
        assert_eq!(
            fs::read_to_string(directory.join("sample (1).txt")).unwrap(),
            "inline"
        );
        assert_eq!(result["results"][1]["name"], "bad_.bin");
        assert_eq!(fs::read(directory.join("bad_.bin")).unwrap(), b"AB");
        assert_eq!(
            result["results"][2]["error"],
            "Dropped file name is invalid"
        );
        assert_eq!(
            result["results"][3]["error"],
            "Dropped file data is invalid"
        );

        assert!(write_dropped_files(&json!({ "dir": directory, "files": [] })).is_err());
        assert!(
            write_dropped_files(&json!({
                "dir": "relative",
                "files": [{ "name": "x", "data": [] }]
            }))
            .is_err()
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
