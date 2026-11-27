use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde_json::{Value, json};

const COMPONENT_APP_ENTRIES: [&str; 4] = ["Index.tsx", "Index.ts", "Index.jsx", "Index.js"];
const ICONS: [(&str, &str); 5] = [
    (".ico", "image/x-icon"),
    (".jpeg", "image/jpeg"),
    (".jpg", "image/jpeg"),
    (".png", "image/png"),
    (".svg", "image/svg+xml"),
];

#[derive(Default)]
struct ComponentAppSources {
    directories: Vec<PathBuf>,
}

fn read_directories(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!("Could not list {}: {error}", path.display()));
        }
    };
    entries
        .map(|entry| entry.map_err(|error| format!("Could not read {}: {error}", path.display())))
        .collect()
}

fn is_file(path: &Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(format!("Could not inspect {}: {error}", path.display())),
    }
}

fn is_built(root: &Path, category: &str, name: &str) -> Result<bool, String> {
    let relative_path = Path::new(category).join(name).join("index.html");
    if is_file(&root.join("public").join("omniscience").join(&relative_path))? {
        return Ok(true);
    }
    is_file(&root.join("dist").join(relative_path))
}

fn component_app_sources(root: &Path) -> Result<BTreeMap<String, ComponentAppSources>, String> {
    let mut apps = BTreeMap::new();
    for relative_root in ["legacy/componentapps", "componentapps"] {
        let directory = root.join(relative_root);
        for entry in read_directories(&directory)? {
            let file_type = entry.file_type().map_err(|error| {
                format!("Could not inspect {}: {error}", entry.path().display())
            })?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !file_type.is_dir() || name.starts_with('.') || name.starts_with("PASTE ") {
                continue;
            }
            apps.entry(name)
                .or_insert_with(ComponentAppSources::default)
                .directories
                .insert(0, entry.path());
        }
    }
    Ok(apps)
}

fn has_component_app_entry(sources: &ComponentAppSources) -> Result<bool, String> {
    for directory in &sources.directories {
        if is_file(&directory.join("index.html"))? {
            return Ok(true);
        }
    }
    for directory in &sources.directories {
        for entry in COMPONENT_APP_ENTRIES {
            if is_file(&directory.join(entry))? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn has_source_entry(root: &Path, category: &str, name: &str) -> Result<bool, String> {
    is_file(&root.join(category).join(name).join("index.html"))
}

fn list_programs_for_directory(root: &Path, category: &str) -> Result<Vec<Value>, String> {
    let mut programs = Vec::new();
    for entry in read_directories(&root.join(category))? {
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", entry.path().display()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !file_type.is_dir() || name.starts_with('.') || name.starts_with("PASTE ") {
            continue;
        }
        let entry_point = if has_source_entry(root, category, &name)? {
            Some(Path::new(category).join(&name).join("index.html"))
        } else {
            None
        };
        let built = is_built(root, category, &name)?;
        programs.push(json!({
            "id": format!("{category}:{name}"),
            "name": name,
            "category": category,
            "entryPoint": entry_point.map(|path| path.to_string_lossy().replace('\\', "/")),
            "launchable": category == "webapps" && built,
        }));
    }
    Ok(programs)
}

fn list_component_apps(root: &Path, platform: &str) -> Result<Vec<Value>, String> {
    let mut programs = Vec::new();
    for (name, sources) in component_app_sources(root)? {
        let has_entry = has_component_app_entry(&sources)?;
        let built = has_entry && is_built(root, "componentapps", &name)?;
        programs.push(json!({
            "id": format!("componentapps:{name}"),
            "name": name,
            "category": "componentapps",
            "entryPoint": has_entry.then(|| {
                Path::new("componentapps")
                    .join(&name)
                    .join("index.html")
                    .to_string_lossy()
                    .replace('\\', "/")
            }),
            "launchable": built && (name != "windows-settings" || platform == "win32"),
        }));
    }
    Ok(programs)
}

pub(crate) fn list_programs(root: &Path, platform: &str) -> Result<Vec<Value>, String> {
    let mut programs = list_component_apps(root, platform)?;
    programs.extend(list_programs_for_directory(root, "webapps")?);
    programs.extend(list_programs_for_directory(root, "extensions")?);
    programs.sort_by(|left, right| {
        let left_category = left["category"].as_str().unwrap_or_default();
        let right_category = right["category"].as_str().unwrap_or_default();
        let left_name = left["name"].as_str().unwrap_or_default();
        let right_name = right["name"].as_str().unwrap_or_default();
        left_category
            .cmp(right_category)
            .then_with(|| left_name.cmp(right_name))
    });
    Ok(programs)
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

fn program_icon(root: &Path, category: &str, name: &str) -> Result<Option<String>, String> {
    for (extension, mime_type) in ICONS {
        let path = root
            .join(category)
            .join(name)
            .join(format!("favicon{extension}"));
        match fs::read(&path) {
            Ok(contents) => {
                return Ok(Some(format!(
                    "data:{mime_type};base64,{}",
                    encode_base64(&contents)
                )));
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                continue;
            }
            Err(error) => return Err(format!("Could not read {}: {error}", path.display())),
        }
    }
    Ok(None)
}

fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub(crate) fn overview_apps(root: &Path, platform: &str) -> Result<Value, String> {
    let programs = list_programs(root, platform)?;
    let mut apps = Vec::new();
    for program in programs {
        let category = program["category"]
            .as_str()
            .ok_or_else(|| "Program category is missing".to_string())?;
        if category != "componentapps" && category != "webapps" {
            continue;
        }
        let name = program["name"]
            .as_str()
            .ok_or_else(|| "Program name is missing".to_string())?;
        if !is_built(root, category, name)? {
            continue;
        }
        apps.push(json!({
            "id": name,
            "type": if category == "componentapps" { "componentapp" } else { "webapp" },
            "title": name,
            "url": format!(
                "/omniscience/{category}/{}/index.html",
                encode_uri_component(name)
            ),
            "icon": program_icon(root, category, name)?,
            "launchable": program["launchable"],
            "preloadPath": null,
        }));
    }
    Ok(Value::Array(apps))
}

#[cfg(test)]
mod tests {
    use super::{encode_base64, list_programs, overview_apps};
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "omni-rust-programs-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed),
        ))
    }

    #[test]
    fn lists_component_apps_web_apps_and_extensions_with_launchability() {
        let root = test_root();
        for directory in [
            "legacy/componentapps/legacy-only",
            "componentapps/shared",
            "legacy/componentapps/shared",
            "componentapps/no-entry",
            "webapps/site",
            "extensions/theme",
            "public/omniscience/componentapps/legacy-only",
            "dist/componentapps/legacy-only",
            "dist/componentapps/shared",
            "dist/componentapps/no-entry",
            "webapps/site",
            "public/omniscience/webapps/site",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        fs::write(
            root.join("legacy/componentapps/legacy-only/Index.tsx"),
            "export default 1",
        )
        .unwrap();
        fs::write(
            root.join("componentapps/shared/Index.js"),
            "export default 1",
        )
        .unwrap();
        fs::write(root.join("webapps/site/index.html"), "<html></html>").unwrap();
        fs::write(
            root.join("dist/componentapps/legacy-only/index.html"),
            "<html></html>",
        )
        .unwrap();
        fs::write(
            root.join("dist/componentapps/shared/index.html"),
            "<html></html>",
        )
        .unwrap();
        fs::write(
            root.join("public/omniscience/webapps/site/index.html"),
            "<html></html>",
        )
        .unwrap();
        fs::write(root.join("componentapps/shared/favicon.svg"), "<svg/>").unwrap();

        let programs = list_programs(&root, "linux").unwrap();
        assert_eq!(
            serde_json::Value::Array(programs),
            json!([
                {
                    "id": "componentapps:legacy-only",
                    "name": "legacy-only",
                    "category": "componentapps",
                    "entryPoint": "componentapps/legacy-only/index.html",
                    "launchable": true
                },
                {
                    "id": "componentapps:no-entry",
                    "name": "no-entry",
                    "category": "componentapps",
                    "entryPoint": null,
                    "launchable": false
                },
                {
                    "id": "componentapps:shared",
                    "name": "shared",
                    "category": "componentapps",
                    "entryPoint": "componentapps/shared/index.html",
                    "launchable": true
                },
                {
                    "id": "extensions:theme",
                    "name": "theme",
                    "category": "extensions",
                    "entryPoint": null,
                    "launchable": false
                },
                {
                    "id": "webapps:site",
                    "name": "site",
                    "category": "webapps",
                    "entryPoint": "webapps/site/index.html",
                    "launchable": true
                }
            ])
        );
        let apps = overview_apps(&root, "linux").unwrap();
        let apps = apps.as_array().unwrap();
        let shared = apps
            .iter()
            .find(|app| app["id"] == "shared")
            .expect("shared component app should be listed");
        assert_eq!(shared["icon"], "data:image/svg+xml;base64,PHN2Zy8+");
        let webapp = apps
            .iter()
            .find(|app| app["id"] == "site")
            .expect("web app should be listed");
        assert_eq!(webapp["url"], "/omniscience/webapps/site/index.html");
        assert_eq!(webapp["type"], "webapp");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn base64_encoding_handles_padding() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"a"), "YQ==");
        assert_eq!(encode_base64(b"ab"), "YWI=");
        assert_eq!(encode_base64(b"abc"), "YWJj");
    }
}
