//! Prune of baked texture levels: a `textures/<sha>/` folder that no surviving
//! manifest names goes away, like a page object. Split out of `compiler_prune.rs`
//! to keep the repository line limit.
use super::*;

/// Removes under `native/textures/` every fingerprint folder that `keep` names for
/// no scope, and every folder of a rule version other than this compiler's: surviving
/// manifests are written by it, so nothing reads those levels any more. Returns the
/// folders removed and the bytes reclaimed.
pub(super) fn prune_textures(native: &Path, keep: &BTreeSet<String>) -> Result<(usize, u64)> {
    let mut removed = 0usize;
    let mut bytes = 0u64;
    let current = native.join(texture_preview::texture_version_dir());
    let Ok(versions) = fs::read_dir(native.join(texture_preview::TEXTURE_DIR)) else {
        return Ok((0, 0));
    };
    for version in versions {
        let version = version?;
        if !version.file_type()?.is_dir() {
            continue;
        }
        if version.path() != current {
            bytes += dir_bytes(&version.path());
            fs::remove_dir_all(version.path())?;
            removed += 1;
            continue;
        }
        for entry in fs::read_dir(version.path())? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !entry.file_type()?.is_dir() || keep.contains(name) {
                continue;
            }
            bytes += dir_bytes(&entry.path());
            fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok((removed, bytes))
}

/// Bytes of the files in a folder, including subfolders; zero for what cannot be read.
fn dir_bytes(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_bytes(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}
