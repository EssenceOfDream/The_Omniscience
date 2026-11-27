use serde_json::{Value, json};

#[cfg(target_os = "windows")]
use std::{
    env,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

pub(super) fn open_everything() -> Result<Value, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Everything search is only available on Windows".to_string());

    #[cfg(target_os = "windows")]
    {
        let executable = resolve_executable()?;
        use std::os::windows::process::CommandExt;
        Command::new(&executable)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|error| {
                format!(
                    "Could not open Everything at {}: {error}",
                    executable.display()
                )
            })?;
        Ok(json!({ "opened": true }))
    }
}

#[cfg(target_os = "windows")]
fn resolve_executable() -> Result<PathBuf, String> {
    let candidates = candidate_paths(
        env::var_os("ProgramFiles"),
        env::var_os("ProgramFiles(x86)"),
        env::var_os("LOCALAPPDATA"),
    );
    if let Some(executable) = candidates.into_iter().find(|path| path.is_file()) {
        return Ok(executable);
    }

    for key in [
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Everything.exe",
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Everything.exe",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Everything.exe",
    ] {
        if let Some(executable) = read_registry_executable(key)? {
            if executable.is_file() {
                return Ok(executable);
            }
        }
    }
    Err("Everything.exe was not found. Install Everything to use panel search.".to_string())
}

#[cfg(target_os = "windows")]
fn candidate_paths(
    program_files: Option<std::ffi::OsString>,
    program_files_x86: Option<std::ffi::OsString>,
    local_app_data: Option<std::ffi::OsString>,
) -> Vec<PathBuf> {
    [
        program_files.map(PathBuf::from),
        program_files_x86.map(PathBuf::from),
        local_app_data.map(|path| PathBuf::from(path).join("Programs")),
    ]
    .into_iter()
    .flatten()
    .map(|root| root.join("Everything").join("Everything.exe"))
    .collect()
}

#[cfg(target_os = "windows")]
fn read_registry_executable(key: &str) -> Result<Option<PathBuf>, String> {
    use std::os::windows::process::CommandExt;

    let mut child = Command::new("reg.exe")
        .args(["query", key, "/ve"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("Could not query the registry for Everything.exe: {error}"))?;

    let status = wait_for_registry_query(&mut child, key)?;
    let mut stdout = String::new();
    if let Some(mut output) = child.stdout.take() {
        output
            .read_to_string(&mut stdout)
            .map_err(|error| format!("Could not read the registry result for {key}: {error}"))?;
    }
    let mut stderr = String::new();
    if let Some(mut output) = child.stderr.take() {
        output
            .read_to_string(&mut stderr)
            .map_err(|error| format!("Could not read registry errors for {key}: {error}"))?;
    }

    if status.success() {
        Ok(parse_registry_executable(&stdout))
    } else if status.code() == Some(1) {
        Ok(None)
    } else {
        Err(format!(
            "Could not query registry key {key}: {}",
            stderr.trim()
        ))
    }
}

#[cfg(target_os = "windows")]
fn wait_for_registry_query(
    child: &mut Child,
    key: &str,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                child
                    .kill()
                    .map_err(|error| format!("Could not stop registry query for {key}: {error}"))?;
                let _ = child.wait();
                return Err(format!("Registry query for {key} timed out"));
            }
            Err(error) => {
                return Err(format!("Could not check registry query for {key}: {error}"));
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn parse_registry_executable(output: &str) -> Option<PathBuf> {
    output.lines().find_map(|line| {
        let remainder = line.trim().strip_prefix("(Default)")?.trim_start();
        let value_type_end = remainder.find(char::is_whitespace)?;
        let value_type = &remainder[..value_type_end];
        if value_type != "REG_SZ" && value_type != "REG_EXPAND_SZ" {
            return None;
        }
        let value = remainder[value_type_end..].trim();
        if value.is_empty() {
            return None;
        }
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(value);
        Some(PathBuf::from(value))
    })
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    use super::{candidate_paths, parse_registry_executable};

    #[cfg(target_os = "windows")]
    #[test]
    fn everything_lookup_preserves_installation_order_and_registry_paths() {
        assert_eq!(
            candidate_paths(
                Some(r"C:\Program Files".into()),
                Some(r"C:\Program Files (x86)".into()),
                Some(r"C:\Users\Test\AppData\Local".into())
            ),
            [
                r"C:\Program Files\Everything\Everything.exe",
                r"C:\Program Files (x86)\Everything\Everything.exe",
                r"C:\Users\Test\AppData\Local\Programs\Everything\Everything.exe",
            ]
            .map(std::path::PathBuf::from)
        );
        assert_eq!(
            parse_registry_executable(
                r#"HKEY_CURRENT_USER\Software\App Paths\Everything.exe
    (Default)    REG_SZ    "C:\Apps\Everything.exe"
"#
            ),
            Some(std::path::PathBuf::from(r"C:\Apps\Everything.exe"))
        );
        assert_eq!(parse_registry_executable("ERROR: key not found"), None);
    }
}
