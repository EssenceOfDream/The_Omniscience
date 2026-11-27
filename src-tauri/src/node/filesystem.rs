mod absolute_path;
mod create_entry;
mod delete_path;
mod get_entry;
mod get_user_directories;
mod list_directory;
mod media_kind;
mod parent_directory;
mod read_desktop_directory;
mod rename_entry;
mod safe_entry_name;

use serde_json::Value;

pub(super) fn dispatch(method: &str, payload: &Value) -> Result<Option<Value>, String> {
    let result = match method {
        "list-directory" => list_directory::list_directory(payload).map(Some),
        "get-user-dirs" => get_user_directories::get_user_directories().map(Some),
        "read-desktop-directory" => Ok(Some(read_desktop_directory::read_desktop_directory(
            payload,
        ))),
        "create-folder" => create_entry::create_entry(payload, true).map(Some),
        "create-file" => create_entry::create_entry(payload, false).map(Some),
        "rename-path" => rename_entry::rename_entry(payload).map(Some),
        "delete-path" => delete_path::delete_path(payload).map(Some),
        "parent-directory" => parent_directory::parent_directory(payload).map(Some),
        _ => return Ok(None),
    };
    result
}

#[cfg(test)]
mod tests {
    use super::dispatch;
    use serde_json::json;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn filesystem_requests_are_handled_in_rust_and_preserve_bridge_shapes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("omni-fs-{unique}"));
        fs::create_dir(&directory).unwrap();
        let directory_string = directory.to_string_lossy().to_string();

        dispatch(
            "create-file",
            &json!({ "parentPath": directory_string, "name": "photo.JPG" }),
        )
        .unwrap()
        .unwrap();
        dispatch(
            "create-folder",
            &json!({ "parentPath": directory, "name": "folder" }),
        )
        .unwrap()
        .unwrap();

        let listing = dispatch("list-directory", &json!({ "path": directory }))
            .unwrap()
            .unwrap();
        assert_eq!(listing["entries"].as_array().unwrap().len(), 2);
        let desktop = dispatch("read-desktop-directory", &json!({ "path": directory }))
            .unwrap()
            .unwrap();
        assert!(desktop["success"].as_bool().unwrap());
        assert_eq!(desktop["files"][1]["mediaKind"], "image");
        assert!(
            dispatch(
                "create-file",
                &json!({ "parentPath": directory, "name": "photo.JPG" })
            )
            .is_err()
        );

        let old_path = directory.join("folder");
        let renamed = dispatch(
            "rename-path",
            &json!({ "path": old_path, "name": "renamed" }),
        )
        .unwrap()
        .unwrap();
        assert!(std::path::Path::new(renamed["path"].as_str().unwrap()).is_dir());
        assert_eq!(
            dispatch(
                "parent-directory",
                &json!({ "path": directory.join("renamed") })
            )
            .unwrap()
            .unwrap(),
            json!(directory)
        );
        dispatch(
            "delete-path",
            &json!({ "path": directory.join("photo.JPG") }),
        )
        .unwrap()
        .unwrap();
        assert!(
            dispatch("unknown-node-method", &json!({}))
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn filesystem_dispatch_rejects_relative_paths_and_unsafe_names() {
        assert!(dispatch("list-directory", &json!({ "path": "relative" })).is_err());
        assert!(
            dispatch(
                "create-file",
                &json!({ "parentPath": std::env::temp_dir(), "name": "../escape" })
            )
            .is_err()
        );
    }
}
