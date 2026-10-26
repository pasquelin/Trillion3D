//! A job text given as a file path, or as `-` for standard input: read the same way by the
//! compiler and the oracle command lines.
use std::io::Read;

/// The text of the file at `path`, or of standard input when `path` is `-`; the error names the
/// path for a file.
pub fn read_job(path: &str) -> Result<String, String> {
    if path == "-" {
        let mut text = String::new();
        std::io::stdin()
            .lock()
            .read_to_string(&mut text)
            .map_err(|error| error.to_string())?;
        Ok(text)
    } else {
        std::fs::read_to_string(path).map_err(|error| format!("{path}: {error}"))
    }
}
