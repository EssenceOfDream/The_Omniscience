use std::path::Path;

pub(super) fn media_kind(name: &str) -> Option<&'static str> {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if [
        "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "svg", "avif", "ico",
    ]
    .contains(&extension.as_str())
    {
        Some("image")
    } else if [
        "mp4", "webm", "mkv", "mov", "avi", "m4v", "ogv", "flv", "wmv", "mpg", "mpeg",
    ]
    .contains(&extension.as_str())
    {
        Some("video")
    } else if [
        "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma", "aiff", "alac",
    ]
    .contains(&extension.as_str())
    {
        Some("audio")
    } else {
        None
    }
}
