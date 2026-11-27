use std::path::PathBuf;

#[cfg(target_os = "windows")]
use std::process::{Command, Stdio};

use serde_json::{Value, json};

#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

pub(super) fn open_windows_settings_category(payload: &Value) -> Result<Value, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = payload;
        return Err("Windows settings are only available on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let category = payload
            .get("category")
            .and_then(Value::as_str)
            .ok_or_else(|| "Windows settings category was not found".to_string())?;
        let args = settings_category_args(category)
            .ok_or_else(|| "Windows settings category was not found".to_string())?;
        let control_path = control_executable_path();
        let mut command = Command::new(&control_path);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        command.spawn().map_err(|error| {
            format!("Could not open Windows settings category {category}: {error}")
        })?;
        Ok(json!({ "ok": true }))
    }
}

#[cfg(target_os = "windows")]
fn settings_category_args(category: &str) -> Option<&'static [&'static str]> {
    match category {
        "system" => Some(&["sysdm.cpl"]),
        "devices" => Some(&["printers"]),
        "network" => Some(&["ncpa.cpl"]),
        "personalization" => Some(&["/name", "Microsoft.Personalization"]),
        "apps" => Some(&["appwiz.cpl"]),
        "accounts" => Some(&["/name", "Microsoft.UserAccounts"]),
        "timeLanguage" => Some(&["intl.cpl"]),
        "gaming" => Some(&["joy.cpl"]),
        "accessibility" => Some(&["/name", "Microsoft.EaseOfAccessCenter"]),
        "search" => Some(&["/name", "Microsoft.IndexingOptions"]),
        "privacy" => Some(&["inetcpl.cpl"]),
        "update" => Some(&["/name", "Microsoft.WindowsUpdate"]),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn control_executable_path() -> PathBuf {
    let windows_directory = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    windows_directory.join("System32").join("control.exe")
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    use super::{control_executable_path, settings_category_args};

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_settings_categories_map_to_the_legacy_control_panel_arguments() {
        assert_eq!(settings_category_args("system"), Some(&["sysdm.cpl"][..]));
        assert_eq!(
            settings_category_args("personalization"),
            Some(&["/name", "Microsoft.Personalization"][..])
        );
        assert_eq!(
            settings_category_args("update"),
            Some(&["/name", "Microsoft.WindowsUpdate"][..])
        );
        assert_eq!(settings_category_args("arbitrary-command"), None);
        assert!(
            control_executable_path()
                .to_string_lossy()
                .ends_with(r"\System32\control.exe")
        );
    }
}
