use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

use crate::node::filesystem::resolve_absolute_path;

pub(crate) fn list_componentapp_files(raw_path: Option<&str>) -> Result<Value, String> {
    let directory = resolve_absolute_path(raw_path, "An absolute directory path is required")?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) => return Ok(listing_error(&error)),
    };

    let mut files = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => return Ok(listing_error(&error)),
        };
        let path = entry.path();
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => return Ok(listing_error(&error)),
        };
        let modified = match metadata.modified() {
            Ok(modified) => modified,
            Err(error) => return Ok(listing_error(&error)),
        };
        files.push(json!({
            "id": path,
            "name": entry.file_name().to_string_lossy(),
            "isDir": metadata.is_dir(),
            "size": metadata.len(),
            "modDate": iso8601(modified),
        }));
    }

    Ok(json!({ "success": true, "files": files }))
}

fn listing_error(error: &std::io::Error) -> Value {
    json!({
        "success": false,
        "error": if error.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "unknown"
        },
    })
}

fn iso8601(timestamp: SystemTime) -> String {
    let milliseconds = match timestamp.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i128,
        Err(error) => -(error.duration().as_millis() as i128),
    };
    let days = milliseconds.div_euclid(86_400_000) as i64;
    let day_milliseconds = milliseconds.rem_euclid(86_400_000);
    let (year, month, day) = civil_date_from_days(days);
    let hour = day_milliseconds / 3_600_000;
    let minute = day_milliseconds / 60_000 % 60;
    let second = day_milliseconds / 1_000 % 60;
    let subsecond = day_milliseconds % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{subsecond:03}Z")
}

fn civil_date_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted_days = days_since_epoch + 719_468;
    let era = if shifted_days >= 0 {
        shifted_days
    } else {
        shifted_days - 146_096
    } / 146_097;
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{civil_date_from_days, iso8601, list_componentapp_files};
    use serde_json::json;
    use std::{fs, path::PathBuf, time::UNIX_EPOCH};

    #[test]
    fn componentapp_file_listing_preserves_legacy_fields_and_timestamp_format() {
        let directory = std::env::temp_dir().join(format!(
            "omni-component-files-{}-{}",
            std::process::id(),
            UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let file_path = directory.join("sample.txt");
        fs::write(&file_path, "hello").unwrap();

        let result = list_componentapp_files(directory.to_str()).unwrap();
        assert_eq!(result["success"], true);
        let file = result["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["name"] == "sample.txt")
            .unwrap();
        assert_eq!(file["id"], json!(file_path));
        assert_eq!(file["isDir"], false);
        assert_eq!(file["size"], 5);
        let date = file["modDate"].as_str().unwrap();
        assert_eq!(date.len(), 24);
        assert!(date.ends_with('Z'));

        assert_eq!(civil_date_from_days(0), (1970, 1, 1));
        assert_eq!(civil_date_from_days(-1), (1969, 12, 31));
        assert_eq!(iso8601(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            list_componentapp_files(Some("relative")).unwrap_err(),
            "An absolute directory path is required"
        );
        assert_eq!(
            list_componentapp_files(Some(
                &PathBuf::from(&directory).join("missing").to_string_lossy()
            ))
            .unwrap(),
            json!({ "success": false, "error": "unknown" })
        );

        fs::remove_dir_all(directory).unwrap();
    }
}
