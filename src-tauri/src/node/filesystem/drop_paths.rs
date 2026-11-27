use std::{fs, path::Path};

use serde_json::{Value, json};

use super::absolute_path::absolute_path;

pub(super) fn drop_paths(payload: &Value) -> Result<Value, String> {
    let sources = payload
        .get("paths")
        .and_then(Value::as_array)
        .filter(|paths| !paths.is_empty())
        .ok_or_else(|| "At least one file path is required".to_string())?
        .iter()
        .map(|path| {
            let source = absolute_path(path.as_str(), "An absolute file path is required")?;
            fs::symlink_metadata(&source)
                .map_err(|error| format!("Could not access {}: {error}", source.display()))?;
            Ok(source)
        })
        .collect::<Result<Vec<_>, String>>()?;

    let directory = absolute_path(
        payload.get("dir").and_then(Value::as_str),
        "An absolute directory path is required",
    )?;
    let directory_metadata = fs::metadata(&directory)
        .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
    if !directory_metadata.is_dir() {
        return Err("Drop destination is not a directory".to_string());
    }

    let is_move = payload.get("isMove").and_then(Value::as_bool) == Some(true);
    let results = sources
        .iter()
        .map(|source| transfer_one_path(source, &directory, is_move))
        .collect::<Vec<_>>();
    let all_succeeded = results
        .iter()
        .all(|result| result.get("success").and_then(Value::as_bool) == Some(true));

    Ok(json!({
        "success": all_succeeded,
        "results": results,
    }))
}

fn transfer_one_path(source: &Path, directory: &Path, is_move: bool) -> Value {
    let source_string = source.to_string_lossy().to_string();
    let Some(name) = source.file_name() else {
        return json!({
            "source": source_string,
            "destination": directory,
            "success": false,
            "error": "Source path has no file name",
        });
    };
    let destination = directory.join(name);
    let destination_string = destination.to_string_lossy().to_string();
    let result = transfer_path(source, &destination, directory, is_move);
    match result {
        Ok(()) => json!({
            "source": source_string,
            "destination": destination_string,
            "success": true,
        }),
        Err(error) => json!({
            "source": source_string,
            "destination": destination_string,
            "success": false,
            "error": error,
        }),
    }
}

fn transfer_path(
    source: &Path,
    destination: &Path,
    directory: &Path,
    is_move: bool,
) -> Result<(), String> {
    if source.parent() == Some(directory) {
        return Err("Source and destination are the same directory".to_string());
    }
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
    if source_metadata.is_dir() && is_path_inside(directory, source) {
        return Err("A directory cannot be dropped into itself".to_string());
    }
    match fs::symlink_metadata(destination) {
        Ok(_) => return Err("Destination already exists".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not inspect {}: {error}",
                destination.display()
            ));
        }
    }

    if is_move {
        match fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error) if is_cross_device(&error) => {
                copy_entry(source, destination)?;
                remove_entry(source).map_err(|error| {
                    format!(
                        "Could not remove {} after moving it: {error}",
                        source.display()
                    )
                })?;
                return Ok(());
            }
            Err(error) => {
                return Err(format!(
                    "Could not move {} to {}: {error}",
                    source.display(),
                    destination.display()
                ));
            }
        }
    }

    if source_metadata.is_dir() {
        copy_directory(source, destination)
    } else {
        copy_file_exclusive(source, destination)
    }
}

fn is_path_inside(candidate: &Path, parent: &Path) -> bool {
    let candidate = candidate.components().collect::<Vec<_>>();
    let parent = parent.components().collect::<Vec<_>>();
    candidate.len() >= parent.len()
        && candidate
            .iter()
            .zip(parent.iter())
            .all(|(candidate, parent)| components_equal(candidate, parent))
}

#[cfg(target_os = "windows")]
fn components_equal(left: &std::path::Component<'_>, right: &std::path::Component<'_>) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(target_os = "windows"))]
fn components_equal(left: &std::path::Component<'_>, right: &std::path::Component<'_>) -> bool {
    left == right
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        copy_symlink(source, destination)
    } else if metadata.is_dir() {
        copy_directory(source, destination)
    } else {
        copy_file_exclusive(source, destination)
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Could not list {}: {error}", source.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_file_exclusive(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input = fs::File::open(source)
        .map_err(|error| format!("Could not open {}: {error}", source.display()))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    if let Err(error) = std::io::copy(&mut input, &mut output) {
        drop(output);
        if let Err(cleanup_error) = fs::remove_file(destination) {
            eprintln!(
                "[filesystem] could not remove incomplete copy {}: {cleanup_error}",
                destination.display()
            );
        }
        return Err(format!("Could not copy {}: {error}", source.display()));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::fs::{symlink_dir, symlink_file};

    let target = fs::read_link(source)
        .map_err(|error| format!("Could not read symbolic link {}: {error}", source.display()))?;
    let is_directory = fs::metadata(source)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false);
    let result = if is_directory {
        symlink_dir(target, destination)
    } else {
        symlink_file(target, destination)
    };
    result.map_err(|error| format!("Could not copy symbolic link {}: {error}", source.display()))
}

#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    let target = fs::read_link(source)
        .map_err(|error| format!("Could not read symbolic link {}: {error}", source.display()))?;
    std::os::unix::fs::symlink(target, destination)
        .map_err(|error| format!("Could not copy symbolic link {}: {error}", source.display()))
}

#[cfg(not(any(target_os = "windows", unix)))]
fn copy_symlink(source: &Path, _destination: &Path) -> Result<(), String> {
    Err(format!(
        "Copying symbolic links is not supported for {}",
        source.display()
    ))
}

fn remove_entry(path: &Path) -> std::io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn is_cross_device(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::CrossesDevices
        || (cfg!(target_os = "windows") && error.raw_os_error() == Some(17))
        || (cfg!(unix) && error.raw_os_error() == Some(18))
}

#[cfg(test)]
mod tests {
    use super::drop_paths;
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn drop_paths_copies_moves_and_rejects_overwrite_and_self_nesting() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("omni-drop-paths-{unique}"));
        let source_directory = root.join("source");
        let destination = root.join("destination");
        let child_directory = source_directory.join("child");
        fs::create_dir_all(&child_directory).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source_directory.join("copy.txt"), "copy").unwrap();
        fs::write(source_directory.join("move.txt"), "move").unwrap();
        fs::write(source_directory.join("duplicate.txt"), "source").unwrap();
        fs::write(child_directory.join("nested.txt"), "nested").unwrap();
        fs::write(destination.join("duplicate.txt"), "existing").unwrap();

        let copied = drop_paths(&json!({
            "paths": [source_directory.join("copy.txt")],
            "dir": destination,
        }))
        .unwrap();
        assert_eq!(copied["success"], true);
        assert_eq!(
            fs::read_to_string(destination.join("copy.txt")).unwrap(),
            "copy"
        );
        assert!(source_directory.join("copy.txt").exists());

        let copied_directory = drop_paths(&json!({
            "paths": [source_directory.clone()],
            "dir": destination.clone(),
        }))
        .unwrap();
        assert_eq!(copied_directory["success"], true);
        assert_eq!(
            fs::read_to_string(destination.join("source").join("child").join("nested.txt"))
                .unwrap(),
            "nested"
        );

        let moved = drop_paths(&json!({
            "paths": [source_directory.join("move.txt")],
            "dir": destination,
            "isMove": true,
        }))
        .unwrap();
        assert_eq!(moved["success"], true);
        assert!(!source_directory.join("move.txt").exists());
        assert_eq!(
            fs::read_to_string(destination.join("move.txt")).unwrap(),
            "move"
        );

        let rejected = drop_paths(&json!({
            "paths": [source_directory.join("duplicate.txt")],
            "dir": destination,
        }))
        .unwrap();
        assert_eq!(rejected["success"], false);
        assert_eq!(
            rejected["results"][0]["error"],
            "Destination already exists"
        );
        let self_nesting = drop_paths(&json!({
            "paths": [source_directory.clone()],
            "dir": child_directory,
        }))
        .unwrap();
        assert_eq!(
            self_nesting["results"][0]["error"],
            "A directory cannot be dropped into itself"
        );
        assert_eq!(
            fs::read_to_string(destination.join("duplicate.txt")).unwrap(),
            "existing"
        );
        assert!(drop_paths(&json!({ "paths": [], "dir": destination })).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
