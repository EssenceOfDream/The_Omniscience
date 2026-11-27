use std::{
    fs::{self, File},
    io::Read,
};

use serde_json::{Value, json};

use crate::node::filesystem::resolve_absolute_path;

pub(crate) fn read_componentapp_file(payload: &Value) -> Result<Value, String> {
    let path = resolve_file_path(payload)?;
    Ok(match fs::read(&path) {
        Ok(contents) => {
            json!({ "success": true, "content": String::from_utf8_lossy(&contents) })
        }
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    })
}

pub(crate) fn write_componentapp_file(payload: &Value) -> Result<Value, String> {
    let path = resolve_file_path(payload)?;
    let content = payload
        .as_array()
        .and_then(|arguments| arguments.get(1))
        .and_then(Value::as_str)
        .ok_or_else(|| "File content must be a string".to_string())?;
    Ok(match fs::write(&path, content) {
        Ok(()) => json!({ "success": true }),
        Err(error) => json!({ "success": false, "error": error.to_string() }),
    })
}

pub(crate) fn check_componentapp_text_file(payload: &Value) -> Result<Value, String> {
    let path = resolve_file_path(payload)?;
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(Value::Bool(false)),
    };
    let mut buffer = [0; 4096];
    match file.read(&mut buffer) {
        Ok(bytes_read) => Ok(Value::Bool(!buffer[..bytes_read].contains(&0))),
        Err(_) => Ok(Value::Bool(false)),
    }
}

fn resolve_file_path(payload: &Value) -> Result<std::path::PathBuf, String> {
    let path = payload
        .as_array()
        .and_then(|arguments| arguments.first())
        .and_then(Value::as_str);
    resolve_absolute_path(path, "An absolute file path is required")
}

#[cfg(test)]
mod tests {
    use super::{check_componentapp_text_file, read_componentapp_file, write_componentapp_file};
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn monaco_file_operations_preserve_read_write_and_text_detection_contracts() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("omni-monaco-{unique}"));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("sample.txt");
        fs::write(&path, "first version").unwrap();
        let payload = |content: Option<&str>| {
            let mut arguments = vec![json!(path)];
            if let Some(content) = content {
                arguments.push(json!(content));
            }
            Value::Array(arguments)
        };

        assert_eq!(
            read_componentapp_file(&payload(None)).unwrap(),
            json!({ "success": true, "content": "first version" })
        );
        assert_eq!(
            write_componentapp_file(&payload(Some("second version"))).unwrap(),
            json!({ "success": true })
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "second version");
        fs::write(&path, [0xff]).unwrap();
        assert_eq!(
            read_componentapp_file(&payload(None)).unwrap(),
            json!({ "success": true, "content": "\u{fffd}" })
        );
        assert_eq!(check_componentapp_text_file(&payload(None)).unwrap(), true);

        fs::write(&path, [vec![b'a'; 4096], vec![0, b'b']].concat()).unwrap();
        assert_eq!(check_componentapp_text_file(&payload(None)).unwrap(), true);
        fs::write(&path, [vec![b'a'; 100], vec![0]].concat()).unwrap();
        assert_eq!(check_componentapp_text_file(&payload(None)).unwrap(), false);
        assert!(write_componentapp_file(&payload(None)).is_err());
        assert!(read_componentapp_file(&json!(["relative"])).is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    use serde_json::Value;
}
