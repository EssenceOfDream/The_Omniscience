use std::path::Path;

pub(super) fn safe_entry_name(value: Option<&str>) -> Result<String, String> {
    let name = value
        .ok_or_else(|| "A name is required".to_string())?
        .trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || Path::new(name).file_name().and_then(|part| part.to_str()) != Some(name)
        || name.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character <= '\u{1f}'
        })
    {
        return Err("Invalid file or folder name".to_string());
    }
    Ok(name.to_string())
}
