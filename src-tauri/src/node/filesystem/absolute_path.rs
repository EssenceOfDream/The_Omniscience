use std::path::{Component, PathBuf};

pub(super) fn absolute_path(value: Option<&str>, error: &str) -> Result<PathBuf, String> {
    let path = value
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| error.to_string())?;
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => resolved.push(prefix.as_os_str()),
            Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            Component::Normal(part) => resolved.push(part),
        }
    }
    Ok(resolved)
}
