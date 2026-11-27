use serde_json::{Value, json};

use super::{list_directory::list_directory, media_kind::media_kind};

pub(super) fn read_desktop_directory(payload: &Value) -> Value {
    match list_directory(payload) {
        Ok(listing) => {
            let files = listing["entries"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|entry| {
                    let name = entry["name"].as_str().unwrap_or_default();
                    let kind = entry["kind"].as_str().unwrap_or_default();
                    json!({
                        "id": entry["path"],
                        "name": name,
                        "displayName": name,
                        "isDir": kind == "directory",
                        "mediaKind": if kind == "file" { media_kind(name) } else { None },
                        "fileUrl": null,
                        "iconPath": null,
                        "infoTip": null,
                        "size": entry["size"],
                        "modifiedAt": entry["modifiedAt"],
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "success": true,
                "files": files,
                "directoryMetadata": null,
            })
        }
        Err(error) => {
            let error_code = if error.contains("Access is denied")
                || error.contains("Permission denied")
                || error.contains("access denied")
            {
                "permission_denied".to_string()
            } else {
                error
            };
            json!({
                "success": false,
                "files": [],
                "directoryMetadata": null,
                "error": error_code,
            })
        }
    }
}
