use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

fn app_directories(project_root: &Path) -> BTreeMap<String, Vec<PathBuf>> {
    let mut apps = BTreeMap::<String, Vec<PathBuf>>::new();
    for root in [
        project_root.join("legacy").join("componentapps"),
        project_root.join("componentapps"),
    ] {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if !file_type.is_dir() || name.starts_with('.') || name.starts_with("PASTE ") {
                continue;
            }
            apps.entry(name).or_default().push(entry.path());
        }
    }
    apps
}

fn generate_componentapp_backends(project_root: &Path, output_dir: &Path) {
    let mut modules = String::new();
    let mut dispatch_arms = String::new();
    let mut backend_names = Vec::new();
    for (index, (name, directories)) in app_directories(project_root).into_iter().enumerate() {
        let backend = directories
            .iter()
            .rev()
            .map(|directory| directory.join("backend.rs"))
            .find(|path| path.is_file());
        let Some(backend) = backend else {
            continue;
        };
        println!("cargo:rerun-if-changed={}", backend.display());
        let module = format!("componentapp_backend_{index}");
        let escaped_path = backend.to_string_lossy();
        backend_names.push(format!("_app_id == {name:?}"));
        modules.push_str(&format!("#[path = {escaped_path:?}]\nmod {module};\n"));
        dispatch_arms.push_str(&format!("{name:?} => {module}::invoke(method, payload),\n"));
    }

    let source = format!(
        "{modules}\n\
         pub fn has_backend(_app_id: &str) -> bool {{ {backend_names} }}\n\
         #[allow(unused_variables)]\n\
         pub fn dispatch(app_id: &str, method: &str, payload: serde_json::Value) \
         -> Result<serde_json::Value, String> {{\n\
           match app_id {{\n\
             {dispatch_arms}\
             _ => Err(format!(\"No Rust backend is registered for componentapp {{app_id}}\")),\n\
           }}\n\
         }}\n",
        backend_names = if backend_names.is_empty() {
            "false".to_string()
        } else {
            backend_names.join(" || ")
        }
    );
    fs::write(output_dir.join("componentapp_backends.rs"), source)
        .expect("could not write componentapp backend registry");
}

fn main() {
    tauri_build::build();
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let project_root = manifest_dir
        .parent()
        .expect("src-tauri has no project root");
    println!(
        "cargo:rerun-if-changed={}",
        project_root.join("componentapps").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        project_root.join("legacy").join("componentapps").display()
    );
    let output_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    generate_componentapp_backends(project_root, &output_dir);
}
