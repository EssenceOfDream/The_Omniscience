use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[cfg(not(debug_assertions))]
use std::{
    fs::{self, File},
    io::Cursor,
};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

pub(crate) mod filesystem;
mod open_file_path;
mod open_with;
mod reveal_file_path;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) struct NodeRuntime {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    request_id: u64,
}

impl Drop for NodeRuntime {
    fn drop(&mut self) {
        self.input.take();
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(25));
                }
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) struct NodeBridge(pub(crate) Arc<Mutex<NodeRuntime>>);

pub(crate) fn runtime_root(_app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .join("..")
            .canonicalize()
            .map_err(|error| format!("Could not resolve standalone project root: {error}"));
    }

    #[cfg(not(debug_assertions))]
    {
        let app_data_dir = _app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
        let runtime_dir = app_data_dir.join("runtime");
        let marker_path = runtime_dir.join(".runtime-bundle-hash");
        let runtime_is_current = fs::read_to_string(&marker_path)
            .map(|hash| hash.trim() == crate::embedded_runtime::HASH)
            .unwrap_or(false)
            && runtime_dir.join("node.exe").is_file();
        if runtime_is_current {
            return Ok(runtime_dir);
        }

        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("Could not create the app data directory: {error}"))?;
        let staging_dir = app_data_dir.join(format!("runtime-stage-{}", std::process::id()));
        let backup_dir = app_data_dir.join(format!("runtime-backup-{}", std::process::id()));
        if staging_dir.exists() {
            fs::remove_dir_all(&staging_dir).map_err(|error| {
                format!("Could not clear previous runtime staging data: {error}")
            })?;
        }
        if backup_dir.exists() {
            fs::remove_dir_all(&backup_dir)
                .map_err(|error| format!("Could not clear previous runtime backup: {error}"))?;
        }
        fs::create_dir_all(&staging_dir)
            .map_err(|error| format!("Could not prepare runtime extraction: {error}"))?;

        let extract_result = (|| {
            let mut archive =
                zip::ZipArchive::new(Cursor::new(crate::embedded_runtime::BUNDLE))
                    .map_err(|error| format!("Could not open embedded Node.js runtime: {error}"))?;
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|error| format!("Could not read runtime archive entry: {error}"))?;
                let relative_path = entry
                    .enclosed_name()
                    .ok_or_else(|| "Runtime archive contains an unsafe path".to_string())?
                    .to_path_buf();
                if entry
                    .unix_mode()
                    .map(|mode| mode & 0o170000 == 0o120000)
                    .unwrap_or(false)
                {
                    return Err(
                        "Runtime archive contains an unsupported symbolic link".to_string()
                    );
                }
                let output_path = staging_dir.join(relative_path);
                if entry.is_dir() {
                    fs::create_dir_all(&output_path).map_err(|error| {
                        format!(
                            "Could not create runtime directory {}: {error}",
                            output_path.display()
                        )
                    })?;
                    continue;
                }
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "Could not create runtime directory {}: {error}",
                            parent.display()
                        )
                    })?;
                }
                let mut output_file = File::create(&output_path).map_err(|error| {
                    format!(
                        "Could not create runtime file {}: {error}",
                        output_path.display()
                    )
                })?;
                std::io::copy(&mut entry, &mut output_file).map_err(|error| {
                    format!(
                        "Could not extract runtime file {}: {error}",
                        output_path.display()
                    )
                })?;
            }
            fs::write(
                staging_dir.join(".runtime-bundle-hash"),
                crate::embedded_runtime::HASH,
            )
            .map_err(|error| format!("Could not mark the extracted runtime: {error}"))?;
            if runtime_dir.exists() {
                fs::rename(&runtime_dir, &backup_dir).map_err(|error| {
                    format!("Could not replace the previous runtime: {error}")
                })?;
            }
            if let Err(error) = fs::rename(&staging_dir, &runtime_dir) {
                if backup_dir.exists() {
                    fs::rename(&backup_dir, &runtime_dir).map_err(|restore_error| {
                        format!(
                            "Could not install the new runtime ({error}) or restore the previous runtime ({restore_error})"
                        )
                    })?;
                }
                return Err(format!("Could not install the embedded runtime: {error}"));
            }
            if backup_dir.exists() {
                if let Err(error) = fs::remove_dir_all(&backup_dir) {
                    eprintln!("[runtime] Could not remove previous runtime backup: {error}");
                }
            }
            Ok(())
        })();

        if let Err(error) = extract_result {
            if staging_dir.exists() {
                if let Err(cleanup_error) = fs::remove_dir_all(&staging_dir) {
                    eprintln!("[runtime] Could not clean up failed extraction: {cleanup_error}");
                }
            }
            return Err(error);
        }
        Ok(runtime_dir)
    }
}

pub(crate) fn start_node_bridge(app: &AppHandle) -> Result<NodeRuntime, String> {
    let project_root = runtime_root(app)?;
    let script_path = project_root.join("node").join("bridge.mjs");
    let node_executable = if cfg!(debug_assertions) {
        PathBuf::from("node")
    } else {
        project_root.join("node.exe")
    };

    let mut command = Command::new(node_executable);
    command
        .arg(script_path)
        .arg(&project_root)
        .arg(std::process::id().to_string());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Could not start Node.js sidecar: {error}"))?;

    let input = child
        .stdin
        .take()
        .ok_or_else(|| "Node.js sidecar stdin is unavailable".to_string())?;
    let output = child
        .stdout
        .take()
        .ok_or_else(|| "Node.js sidecar stdout is unavailable".to_string())?;

    Ok(NodeRuntime {
        child,
        input: Some(input),
        output: BufReader::new(output),
        request_id: 0,
    })
}

pub(crate) fn request_node(
    runtime: &mut NodeRuntime,
    method: &str,
    payload: Value,
) -> Result<Value, String> {
    if let Some(status) = runtime
        .child
        .try_wait()
        .map_err(|error| format!("Could not check Node.js sidecar: {error}"))?
    {
        return Err(format!("Node.js sidecar exited with status {status}"));
    }

    runtime.request_id += 1;
    let request_id = runtime.request_id;
    let request = json!({ "id": request_id, "method": method, "payload": payload });
    {
        let input = runtime
            .input
            .as_mut()
            .ok_or_else(|| "Node.js sidecar stdin is unavailable".to_string())?;
        serde_json::to_writer(&mut *input, &request)
            .map_err(|error| format!("Could not encode sidecar request: {error}"))?;
        input
            .write_all(b"\n")
            .and_then(|_| input.flush())
            .map_err(|error| format!("Could not send sidecar request: {error}"))?;
    }

    let mut line = String::new();
    runtime
        .output
        .read_line(&mut line)
        .map_err(|error| format!("Could not read sidecar response: {error}"))?;
    if line.is_empty() {
        return Err("Node.js sidecar closed its response stream".to_string());
    }

    let response: Value = serde_json::from_str(&line)
        .map_err(|error| format!("Invalid Node.js sidecar response: {error}"))?;
    if response.get("id").and_then(Value::as_u64) != Some(request_id) {
        return Err("Node.js sidecar returned a mismatched request id".to_string());
    }
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Node.js sidecar request failed")
            .to_string());
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| "Node.js sidecar response is missing its result".to_string())
}

pub(crate) async fn call_node(
    runtime: Arc<Mutex<NodeRuntime>>,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut runtime = runtime
            .lock()
            .map_err(|_| "Node.js sidecar lock is unavailable".to_string())?;
        request_node(&mut runtime, &method, payload)
    })
    .await
    .map_err(|error| format!("Node.js sidecar task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn node_request(
    app: AppHandle,
    state: State<'_, NodeBridge>,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    if let Some(result) = filesystem::dispatch(&method, &payload)? {
        return Ok(result);
    }
    match method.as_str() {
        "open-path" => return open_file_path::open_file_path(&app, &payload),
        "open-with" => return open_with::open_with(&payload),
        "reveal-path" => return reveal_file_path::reveal_file_path(&app, &payload),
        "get-theme" => return crate::theme::current_theme_settings(&app),
        "get-extensions-list" => {
            let runtime = app
                .try_state::<crate::extensions::ExtensionRuntime>()
                .ok_or_else(|| "Chromium extension configuration is unavailable".to_string())?;
            return crate::extensions::list_extensions(&runtime.0);
        }
        "get-apps-list" | "list-programs" => {
            let root = runtime_root(&app)?;
            let platform = if cfg!(target_os = "windows") {
                "win32"
            } else if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            };
            if method == "get-apps-list" {
                return crate::programs::overview_apps(&root, platform);
            }
            return crate::programs::list_programs(&root, platform).map(Value::Array);
        }
        _ => {}
    }
    call_node(Arc::clone(&state.0), method, payload).await
}
