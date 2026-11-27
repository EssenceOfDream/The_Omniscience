use std::{env, fs, path::PathBuf};

use serde_json::{Value, json};

pub(super) fn get_user_directories() -> Result<Value, String> {
    let home = env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| {
            let mut home = env::var_os("HOMEDRIVE")?;
            home.push(env::var_os("HOMEPATH")?);
            Some(PathBuf::from(home))
        })
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "Could not determine the user home directory".to_string())?;

    let desktop = home.join("Desktop");
    let one_drive_desktop = env::var_os("OneDrive").map(|path| PathBuf::from(path).join("Desktop"));
    let desktop_exists = is_directory(&desktop)?;
    let one_drive_exists = one_drive_desktop
        .as_ref()
        .map(|path| is_directory(path))
        .transpose()?
        .unwrap_or(false);
    let desktop_path = if desktop_exists {
        desktop
    } else if let Some(one_drive_desktop) = one_drive_desktop.filter(|_| one_drive_exists) {
        one_drive_desktop
    } else {
        desktop
    };

    Ok(json!({
        "home": home,
        "desktop": desktop_path,
        "download": home.join("Downloads"),
        "documents": home.join("Documents"),
        "pictures": home.join("Pictures"),
        "music": home.join("Music"),
        "videos": home.join("Videos"),
    }))
}

fn is_directory(path: &std::path::Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_dir()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(format!(
            "Could not inspect user directory {}: {error}",
            path.display()
        )),
    }
}
