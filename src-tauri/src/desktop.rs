use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Value, json};
use tauri::{
    AppHandle, LogicalPosition, State, WebviewWindow,
    menu::{MenuBuilder, MenuItemBuilder},
};

use crate::{
    node::{NodeBridge, call_node},
    state::DesktopContextMenuState,
};

#[tauri::command]
pub(crate) async fn start_file_drag(window: WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("At least one file path is required".to_string());
    }
    let paths = paths
        .into_iter()
        .map(|value| {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("Absolute file paths are required for dragging".to_string());
            }
            std::fs::metadata(&path)
                .map_err(|error| format!("Could not access {}: {error}", path.display()))?;
            Ok(path)
        })
        .collect::<Result<Vec<_>, String>>()?;

    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = sender.send(crate::windows_drag::start(paths));
            })
            .map_err(|error| format!("Could not start file drag on the UI thread: {error}"))?;

        return tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|error| format!("File drag did not complete: {error}"))?
        })
        .await
        .map_err(|error| format!("File drag task failed: {error}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, paths);
        Err("Native file dragging is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub(crate) fn trash_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err("A valid absolute file or directory path is required".to_string());
    }

    trash::delete(&path).map_err(|error| {
        format!("Could not move {} to the system trash: {error}", path.display())
    })
}

#[tauri::command]
pub(crate) fn show_desktop_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopContextMenuState>,
    kind: String,
    paths: Vec<String>,
    directory: String,
    x: f64,
    y: f64,
    cut_count: usize,
) -> Result<(), String> {
    if kind != "background" && kind != "files" {
        return Err("Unsupported desktop context menu kind".to_string());
    }
    if !PathBuf::from(&directory).is_absolute()
        || ![x, y].into_iter().all(f64::is_finite)
        || paths.iter().any(|path| !PathBuf::from(path).is_absolute())
    {
        return Err("Invalid desktop context menu location or paths".to_string());
    }
    if kind == "files" && paths.is_empty() {
        return Err("At least one file is required for this context menu".to_string());
    }

    *state
        .0
        .lock()
        .map_err(|_| "Desktop context menu state is unavailable".to_string())? = json!({
            "kind": kind,
            "paths": paths,
            "directory": directory
        });

    let mut menu = MenuBuilder::new(&app);
    if kind == "background" {
        let header =
            MenuItemBuilder::with_id("desktop-context:header", "Рабочий стол")
                .enabled(false)
                .build(&app)
                .map_err(|error| format!("Could not build desktop menu header: {error}"))?;
        menu = menu
            .item(&header)
            .separator()
            .text("desktop-context:create-folder", "Создать папку")
            .text("desktop-context:create-file", "Создать файл")
            .separator()
            .text("desktop-context:paste", "Вставить");
        if cut_count > 0 {
            menu = menu.text(
                "desktop-context:undo-cut",
                format!("Отменить вырезание ({cut_count})"),
            );
        }
        menu = menu
            .separator()
            .text("desktop-context:refresh", "Обновить")
            .text("desktop-context:reveal", "Показать в файловом менеджере");
    } else {
        let count = paths.len();
        let only_one = count == 1;
        let open_with_item = MenuItemBuilder::with_id(
            "desktop-context:open-with",
            "Открыть с помощью…",
        )
        .enabled(only_one)
        .build(&app)
        .map_err(|error| format!("Could not build Open With menu item: {error}"))?;
        let rename_item =
            MenuItemBuilder::with_id("desktop-context:rename", "Переименовать")
                .enabled(only_one)
                .build(&app)
                .map_err(|error| format!("Could not build Rename menu item: {error}"))?;
        let reveal_item =
            MenuItemBuilder::with_id(
                "desktop-context:reveal",
                "Показать в файловом менеджере",
            )
            .enabled(only_one)
            .build(&app)
            .map_err(|error| format!("Could not build Reveal menu item: {error}"))?;
        let header_text = if only_one {
            "Файл".to_string()
        } else {
            format!("Выделено файлов: {count}")
        };
        let header = MenuItemBuilder::with_id("desktop-context:header", header_text)
            .enabled(false)
            .build(&app)
            .map_err(|error| format!("Could not build file menu header: {error}"))?;
        menu = menu
            .item(&header)
            .separator()
            .text(
                "desktop-context:open",
                if only_one { "Открыть".to_string() } else { format!("Открыть все ({count})") },
            )
            .item(&open_with_item)
            .separator()
            .item(&rename_item)
            .text(
                "desktop-context:copy-path",
                if only_one { "Скопировать путь".to_string() } else { format!("Скопировать {count} путей") },
            )
            .item(&reveal_item)
            .separator()
            .text("desktop-context:copy", "Копировать")
            .text("desktop-context:cut", "Вырезать")
            .text("desktop-context:paste", "Вставить");
        if cut_count > 0 {
            menu = menu.text(
                "desktop-context:undo-cut",
                format!("Отменить вырезание ({cut_count})"),
            );
        }
        menu = menu
            .separator()
            .text(
                "desktop-context:trash",
                if only_one { "Удалить в корзину".to_string() } else { format!("Удалить {count} в корзину") },
            )
            .text(
                "desktop-context:delete",
                if only_one { "Удалить безвозвратно".to_string() } else { format!("Удалить безвозвратно ({count})") },
            );
    }
    let menu = menu
        .build()
        .map_err(|error| format!("Could not build desktop context menu: {error}"))?;
    window
        .popup_menu_at(&menu, LogicalPosition::new(x, y))
        .map_err(|error| format!("Could not show desktop context menu: {error}"))
}

#[tauri::command]
pub(crate) async fn get_file_icons(
    state: State<'_, NodeBridge>,
    paths: Vec<String>,
) -> Result<Value, String> {
    call_node(
        Arc::clone(&state.0),
        "get-file-icons".to_string(),
        json!({ "paths": paths }),
    )
    .await
}