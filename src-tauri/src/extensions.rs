use std::{path::Path, sync::OnceLock};

use serde_json::Value;
use tauri::WebviewWindow;

mod storage;
pub(crate) use storage::{
    extension_storage_get, extension_storage_set, read_extension_storage_for_app,
};

pub(crate) struct ExtensionRuntime(pub(crate) Value);

pub(crate) static EXTENSION_INIT_SCRIPT: OnceLock<String> = OnceLock::new();
const EXTENSION_RUNTIME_TEMPLATE: &str = include_str!("extension-runtime.js");

pub(crate) fn list_extensions(runtime: &Value) -> Result<Value, String> {
    let extensions = runtime
        .as_array()
        .ok_or_else(|| "Chromium extension configuration must be an array".to_string())?;
    let entries = extensions
        .iter()
        .map(|extension| {
            let string_field = |field: &str| {
                extension
                    .get(field)
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Chromium extension configuration has no {field}"))
            };
            let id = string_field("id")?;
            let title = string_field("title")?;
            let name = string_field("name")?;
            let version = string_field("version")?;
            let description = string_field("description")?;
            let icon = extension
                .get("icon")
                .ok_or_else(|| "Chromium extension configuration has no icon".to_string())?;
            let popup = extension
                .get("popup")
                .ok_or_else(|| "Chromium extension configuration has no popup".to_string())?;

            Ok(serde_json::json!({
                "id": id,
                "extensionId": id,
                "title": title,
                "name": name,
                "type": "extension",
                "kind": "extension",
                "launchable": popup.as_str().is_some_and(|path| !path.is_empty()),
                "version": version,
                "description": description,
                "icon": icon,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Value::Array(entries))
}

pub(crate) fn extension_popup_launch_data(
    runtime: &Value,
    extension_id: &str,
) -> Result<Value, String> {
    let extensions = runtime
        .as_array()
        .ok_or_else(|| "Chromium extension configuration must be an array".to_string())?;
    let extension = extensions
        .iter()
        .find(|extension| extension.get("id").and_then(Value::as_str) == Some(extension_id))
        .ok_or_else(|| format!("Extension {extension_id} is unavailable"))?;
    let name = extension
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Extension {extension_id} has no name"))?;
    let popup = extension
        .get("popup")
        .and_then(Value::as_str)
        .filter(|popup| !popup.is_empty())
        .ok_or_else(|| format!("Extension {name} has no action popup"))?;
    let icon = extension
        .get("icon")
        .ok_or_else(|| format!("Extension {name} has no icon metadata"))?;
    let app_path = Path::new("omniscience")
        .join("extensions")
        .join(extension_id)
        .join(popup)
        .to_string_lossy()
        .replace('\\', "/");

    Ok(serde_json::json!({
        "kind": "extension_popup",
        "name": name,
        "icon": icon,
        "appPath": app_path,
        "width": 360,
        "height": 600,
    }))
}

pub(crate) fn extension_target_for_webview(label: &str) -> &'static str {
    if label.starts_with("component-") {
        "componentapps"
    } else if label.starts_with("program-extension-") {
        "extensions"
    } else if label.starts_with("program-") {
        "webapps"
    } else {
        "shell"
    }
}

pub(crate) fn build_extension_initialization_script(extensions: &Value) -> Result<String, String> {
    let extension_entries = extensions
        .as_array()
        .ok_or_else(|| "Chromium extension configuration must be an array".to_string())?;
    let mut metadata = extensions.clone();
    let metadata_entries = metadata
        .as_array_mut()
        .ok_or_else(|| "Chromium extension configuration must be an array".to_string())?;
    let mut executors = Vec::new();
    for (extension_index, extension) in extension_entries.iter().enumerate() {
        let metadata_extension = metadata_entries
            .get_mut(extension_index)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "Chromium extension configuration has an invalid entry".to_string())?;
        let mut sections = Vec::new();
        for section_name in ["preloads", "contentScripts"] {
            let entries = extension
                .get(section_name)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut functions = Vec::new();
            for entry in &entries {
                let sources = entry
                    .get("js")
                    .and_then(Value::as_array)
                    .ok_or_else(|| format!("{section_name} JavaScript sources must be an array"))?;
                let mut function = String::from("function(chrome){\n");
                for source in sources {
                    let source = source
                        .as_str()
                        .ok_or_else(|| format!("{section_name} source must be a string"))?;
                    function.push_str(source);
                    function.push_str("\n;\n");
                }
                function.push('}');
                functions.push(function);
            }
            if let Some(metadata_section) = metadata_extension
                .get_mut(section_name)
                .and_then(Value::as_array_mut)
            {
                for entry in metadata_section {
                    if let Some(entry) = entry.as_object_mut() {
                        entry.remove("js");
                    }
                }
            }
            sections.push(format!(
                "\"{section_name}\":[{}]",
                functions.join(",")
            ));
        }
        executors.push(format!("{{{}}}", sections.join(",")));
    }

    let extensions = serde_json::to_string(&metadata)
        .map_err(|error| format!("Could not encode Chromium extensions: {error}"))?;
    let script = EXTENSION_RUNTIME_TEMPLATE
        .replacen("__OMNI_EXTENSION_CONFIG__", &extensions, 1)
        .replacen(
            "__OMNI_EXTENSION_EXECUTORS__",
            &format!("[{}]", executors.join(",")),
            1,
        );
    Ok(script)
}

fn is_webapp_storage_window(label: &str, url: &tauri::Url) -> bool {
    let window_id = label
        .strip_prefix("program-popup-")
        .or_else(|| label.strip_prefix("program-"));
    let has_webapp_label = window_id
        .map(|window_id| {
            !window_id.is_empty() && window_id.bytes().all(|byte| byte.is_ascii_digit())
        })
        .unwrap_or(false);

    has_webapp_label && matches!(url.scheme(), "http" | "https")
}

pub(super) fn validate_extension_storage_window(
    window: &WebviewWindow,
    extension_id: &str,
) -> Result<(), String> {
    let label = window.label();
    if matches!(
        label,
        "desktop" | "panel" | "controls" | "overview" | "window-settings"
    ) || label.starts_with("component-")
    {
        return Ok(());
    }

    let url = window
        .url()
        .map_err(|error| format!("Could not read extension storage window URL: {error}"))?;

    if label.starts_with("program-extension-") {
        let mut expected_url = tauri::Url::parse("http://localhost/")
            .map_err(|error| format!("Could not prepare extension popup URL: {error}"))?;
        expected_url
            .path_segments_mut()
            .map_err(|_| "Could not prepare extension popup URL".to_string())?
            .extend(["omniscience", "extensions", extension_id, ""]);

        if !url.path().starts_with(expected_url.path()) {
            return Err("Extension popup cannot access another extension's storage".to_string());
        }
        return Ok(());
    }

    if is_webapp_storage_window(label, &url) {
        return Ok(());
    }

    Err("Extension storage is unavailable to this window".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_extension_initialization_script, extension_popup_launch_data,
        extension_target_for_webview, is_webapp_storage_window, list_extensions,
    };

    #[test]
    fn extension_popup_launch_data_uses_validated_runtime_resources() {
        let runtime = serde_json::json!([{
            "id": "sample",
            "name": "Sample",
            "icon": null,
            "popup": "popup.html",
        }]);
        assert_eq!(
            extension_popup_launch_data(&runtime, "sample").unwrap(),
            serde_json::json!({
                "kind": "extension_popup",
                "name": "Sample",
                "icon": null,
                "appPath": "omniscience/extensions/sample/popup.html",
                "width": 360,
                "height": 600,
            })
        );
        assert!(extension_popup_launch_data(&runtime, "missing").is_err());
        assert!(
            extension_popup_launch_data(
                &serde_json::json!([{
                    "id": "sample",
                    "name": "Sample",
                    "icon": null,
                    "popup": null,
                }]),
                "sample",
            )
            .is_err()
        );
    }

    #[test]
    fn extension_list_preserves_runtime_metadata_and_popup_launchability() {
        let runtime = serde_json::json!([
            {
                "id": "theme",
                "title": "Theme",
                "name": "Theme",
                "version": "1.0",
                "description": "Theme tools",
                "icon": "data:image/png;base64,aWNvbg==",
                "popup": "popup.html",
            },
            {
                "id": "no-popup",
                "title": "No popup",
                "name": "No popup",
                "version": "2.0",
                "description": "",
                "icon": null,
                "popup": null,
            },
        ]);
        assert_eq!(
            list_extensions(&runtime).unwrap(),
            serde_json::json!([
                {
                    "id": "theme",
                    "extensionId": "theme",
                    "title": "Theme",
                    "name": "Theme",
                    "type": "extension",
                    "kind": "extension",
                    "launchable": true,
                    "version": "1.0",
                    "description": "Theme tools",
                    "icon": "data:image/png;base64,aWNvbg==",
                },
                {
                    "id": "no-popup",
                    "extensionId": "no-popup",
                    "title": "No popup",
                    "name": "No popup",
                    "type": "extension",
                    "kind": "extension",
                    "launchable": false,
                    "version": "2.0",
                    "description": "",
                    "icon": null,
                }
            ])
        );
    }

    #[test]
    fn extension_storage_is_limited_to_http_webapp_and_popup_windows() {
        for label in ["program-1", "program-25", "program-popup-1", "program-popup-25"] {
            for url in ["https://example.com/", "http://127.0.0.1:53808/"] {
                assert!(
                    is_webapp_storage_window(label, &url.parse().unwrap()),
                    "{label} {url}"
                );
            }
        }

        for (label, url) in [
            (
                "program-extension-1",
                "http://localhost/omniscience/extensions/test/",
            ),
            ("program-popup-not-a-number", "https://example.com/"),
            ("component-settings", "http://localhost/"),
            ("program-1", "file:///C:/private.txt"),
        ] {
            assert!(
                !is_webapp_storage_window(label, &url.parse().unwrap()),
                "{label} {url}"
            );
        }
    }

    #[test]
    fn extension_targets_are_selected_from_webview_labels() {
        for (label, target) in [
            ("desktop", "shell"),
            ("panel", "shell"),
            ("component-settings", "componentapps"),
            ("program-1", "webapps"),
            ("program-popup-1", "webapps"),
            ("program-extension-1", "extensions"),
        ] {
            assert_eq!(extension_target_for_webview(label), target);
        }
    }

    #[test]
    fn extension_script_installs_content_scripts_and_chrome_storage_api() {
        let extensions = serde_json::json!([{
            "id": "omni-theme",
            "targets": { "webapps": true, "extensions": true },
            "preloads": [{
                "matches": ["<all_urls>"],
                "css": ["body { color: red; }"],
                "js": ["window.__preload__ = true;"],
            }],
            "contentScripts": [{
                "matches": ["<all_urls>"],
                "runAt": "document_start",
                "css": [],
                "js": ["chrome.storage.local.get({}, () => {});"],
            }],
        }]);
        let script = build_extension_initialization_script(&extensions).unwrap();

        assert!(script.contains("chrome.storage.local.get"));
        assert!(script.contains("extension-storage-changed"));
        assert!(script.contains("body { color: red; }"));
        assert!(script.contains("function(chrome){"));
        assert!(script.contains("\"preloads\":[function(chrome){"));
        assert!(script.contains("\"contentScripts\":[function(chrome){"));
        assert!(script.contains("window.__preload__ = true;"));
        assert!(script.contains("document.__omniExtensionsInitialized"));
        assert!(!script.contains("new Function"));
    }
}
