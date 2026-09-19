//! Conversion audit record left behind: opened files and tried image
//! paths. Re-read on next pass, provides cache key without opening
//! source; if wrong, following conversion writes true key and corrects it.
use super::*;

/// Audit record lives outside `imports/`, which carries only scenes, and
/// belongs to dependency-resolving folder as much as inputs: two sources with same
/// bytes elsewhere open different files. Final key stays per-content.
fn probe_path(cache: &Path, base: &str, root: &Path) -> PathBuf {
    let stamp = hash(format!("{base}\n{}", root.to_string_lossy()).as_bytes());
    let folder = cache.join("native").join("imports-externes");
    folder.join(format!("{stamp}.json"))
}

/// Files previous conversion of same inputs here opened, re-hashed.
pub(crate) fn expected(cache: &Path, base: &str, root: &Path) -> Vec<External> {
    let Ok(bytes) = fs::read(probe_path(cache, base, root)) else {
        return Vec::new();
    };
    let Ok(listed) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    listed
        .as_array()
        .map(|files| files.iter().filter_map(reread).collect())
        .unwrap_or_default()
}

fn reread(entry: &Value) -> Option<External> {
    let path = entry.get("path")?.as_str()?;
    let kind = kind_named(entry.get("kind")?.as_str()?)?;
    Some(describe(Path::new(path), kind))
}

/// Writes record, or removes it when import opened nothing but source.
pub(crate) fn write_probe(cache: &Path, base: &str, root: &Path, files: &[External]) -> Result<()> {
    let path = probe_path(cache, base, root);
    if files.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let listed: Vec<Value> = files
        .iter()
        .map(|file| json!({"path":file.path,"kind":file.kind}))
        .collect();
    atomic(&path, &serde_json::to_vec(&Value::Array(listed))?)
}
