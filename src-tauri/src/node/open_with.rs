use std::{ffi::OsString, fs, path::PathBuf};

#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};

use serde_json::{Value, json};

use super::filesystem::resolve_absolute_path;

#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

pub(super) fn open_with(payload: &Value) -> Result<Value, String> {
    let path = resolve_existing_path(payload)?;
    #[cfg(target_os = "windows")]
    spawn_open_with(&path)?;
    #[cfg(not(target_os = "windows"))]
    return Err("Open With is only supported on Windows".to_string());

    #[cfg(target_os = "windows")]
    Ok(json!({ "opened": true }))
}

fn resolve_existing_path(payload: &Value) -> Result<PathBuf, String> {
    let path = resolve_absolute_path(
        payload.get("path").and_then(Value::as_str),
        "An absolute file path is required",
    )?;
    fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not access {}: {error}", path.display()))?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn spawn_open_with(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    Command::new("rundll32.exe")
        .args(open_with_arguments(path))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the Windows Open With dialog: {error}"))
}

fn open_with_arguments(path: &std::path::Path) -> [OsString; 2] {
    [
        OsString::from("shell32.dll,OpenAs_RunDLL"),
        path.as_os_str().to_os_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::{open_with_arguments, resolve_existing_path};
    use serde_json::json;
    use std::{fs, path::Path, time::SystemTime};

    #[test]
    fn open_with_requires_an_existing_absolute_path_and_preserves_shell_arguments() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omni-open-with-{unique}.txt"));
        fs::write(&path, "open with").unwrap();

        assert_eq!(
            resolve_existing_path(&json!({ "path": path })).unwrap(),
            path
        );
        assert!(resolve_existing_path(&json!({ "path": "relative.txt" })).is_err());
        assert_eq!(
            open_with_arguments(Path::new("C:\\sample.txt")),
            [
                std::ffi::OsString::from("shell32.dll,OpenAs_RunDLL"),
                std::ffi::OsString::from("C:\\sample.txt"),
            ]
        );

        fs::remove_file(path).unwrap();
    }
}
