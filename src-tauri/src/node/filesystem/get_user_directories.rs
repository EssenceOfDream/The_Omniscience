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
    let desktop_path = if fs::metadata(&desktop)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        desktop
    } else if let Some(one_drive_desktop) = one_drive_desktop.filter(|path| {
        fs::metadata(path)
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
    }) {
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
