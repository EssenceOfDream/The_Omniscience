use serde_json::{Value, json};
use std::process::Command;

pub(crate) async fn perform_power_action(payload: &Value) -> Result<Value, String> {
    let action = payload
        .as_array()
        .and_then(|arguments| arguments.first())
        .and_then(|options| options.get("action"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Power action is required".to_string())?
        .to_string();

    tauri::async_runtime::spawn_blocking(move || execute_power_action(&action))
        .await
        .map_err(|error| format!("Power action task failed: {error}"))?
}

fn validate_action(action: &str) -> Result<(), String> {
    match action {
        "logout" | "shutdown" | "restart" | "sleep" => Ok(()),
        _ => Err(format!("Unsupported power action: {action}")),
    }
}

fn execute_power_action(action: &str) -> Result<Value, String> {
    validate_action(action)?;

    #[cfg(target_os = "windows")]
    {
        if action == "sleep" {
            return suspend_windows();
        }
        let args = match action {
            "logout" => ["/l", "", ""],
            "shutdown" => ["/s", "/t", "0"],
            "restart" => ["/r", "/t", "0"],
            _ => unreachable!("action was validated"),
        };
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
        return run_command(
            std::path::Path::new(&system_root)
                .join("System32")
                .join("shutdown.exe")
                .as_os_str()
                .to_owned(),
            args.iter().filter(|argument| !argument.is_empty()).copied(),
        );
    }

    #[cfg(target_os = "linux")]
    {
        return match action {
            "sleep" => run_command("systemctl".into(), ["suspend"]),
            "shutdown" => run_command("systemctl".into(), ["poweroff"]),
            "restart" => run_command("systemctl".into(), ["reboot"]),
            "logout" => {
                if let Some(session_id) = std::env::var_os("XDG_SESSION_ID") {
                    run_command(
                        "loginctl".into(),
                        ["terminate-session", session_id.to_string_lossy().as_ref()],
                    )
                } else {
                    let username = std::env::var_os("USER")
                        .or_else(|| current_username())
                        .ok_or_else(|| "Could not determine the current username".to_string())?;
                    run_command(
                        "loginctl".into(),
                        ["terminate-user", username.to_string_lossy().as_ref()],
                    )
                }
            }
            _ => unreachable!("action was validated"),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = action;
        Err(format!(
            "Power actions are not supported on {}",
            std::env::consts::OS
        ))
    }
}

#[cfg(target_os = "linux")]
fn current_username() -> Option<std::ffi::OsString> {
    let output = Command::new("id").arg("-un").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let username = String::from_utf8(output.stdout).ok()?;
    let username = username.trim();
    (!username.is_empty()).then(|| username.into())
}

fn run_command<I, S>(executable: std::ffi::OsString, arguments: I) -> Result<Value, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = Command::new(executable);
    command.args(arguments);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command
        .status()
        .map_err(|error| format!("Could not execute power action: {error}"))?;
    if !status.success() {
        return Err(format!("Power action command failed with status {status}"));
    }
    Ok(json!({ "ok": true }))
}

#[cfg(target_os = "windows")]
fn suspend_windows() -> Result<Value, String> {
    #[link(name = "PowrProf")]
    unsafe extern "system" {
        fn SetSuspendState(hibernate: u8, force_critical: u8, disable_wake_event: u8) -> u8;
    }

    let suspended = unsafe { SetSuspendState(0, 0, 0) };
    if suspended == 0 {
        return Err(format!(
            "SetSuspendState failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::{execute_power_action, validate_action};

    #[test]
    fn power_menu_accepts_only_supported_actions() {
        for action in ["logout", "shutdown", "restart", "sleep"] {
            assert!(validate_action(action).is_ok());
        }
        assert!(validate_action("run-command").is_err());
        assert!(execute_power_action("run-command").is_err());
    }
}
