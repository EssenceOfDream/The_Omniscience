use std::fs;

use serde_json::{Value, json};

use super::{absolute_path::absolute_path, get_entry::get_entry};

pub(super) fn list_directory(payload: &Value) -> Result<Value, String> {
    let directory = absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute directory path is required",
    )?;
    let metadata = fs::metadata(&directory)
        .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
    if !metadata.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?
        .map(|entry| {
            let entry =
                entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            get_entry(&entry.path(), &name)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut entries = entries;
    entries.sort_by(|left, right| {
        let left_directory = left["kind"] == "directory";
        let right_directory = right["kind"] == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| {
                left["name"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
                    .cmp(&right["name"].as_str().unwrap_or_default().to_lowercase())
            })
            .then_with(|| left["name"].as_str().cmp(&right["name"].as_str()))
    });
    Ok(json!({
        "path": directory,
        "entries": entries,
    }))
}

#[cfg(test)]
mod tests {
    use super::list_directory;
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn directory_listing_sorts_directories_before_files_and_reports_entry_types() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("omni-list-{unique}"));
        fs::create_dir_all(directory.join("z-dir")).unwrap();
        fs::write(directory.join("b.txt"), b"file").unwrap();
        fs::write(directory.join("A.txt"), b"file").unwrap();

        let listing = list_directory(&json!({ "path": directory })).unwrap();
        let names = listing["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["name"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(names, ["z-dir", "A.txt", "b.txt"]);
        assert_eq!(listing["entries"][0]["kind"], "directory");
        assert_eq!(listing["entries"][1]["kind"], "file");

        fs::remove_dir_all(PathBuf::from(listing["path"].as_str().unwrap())).unwrap();
    }
}
