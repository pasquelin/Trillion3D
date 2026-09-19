//! Base of the container drivers: a format that does not carry a scene but the wrapping of a
//! source. A container reads no geometry. It extracts under the cache, then yields the extracted
//! directory to the router: an ordinary scene driver produces the intermediate scene, and the
//! container yields nothing other than what that driver yields.
//!
//! This module holds the protections and the identity, which depend on no format: ceilings, named
//! refusals, directory-escape refusal, extraction key. Its `container` submodule holds the common
//! sequence — extract, mark, route. A second container therefore only adds its reading.
use super::*;
use crate::{hash, is_safe_source_name, CompilerError};
use std::sync::atomic::Ordering;

mod container;
#[cfg(test)]
mod tests;
pub(super) mod zip_reader;

pub(super) use container::container;

/// Ceilings of an extraction. Beyond them, the archive is refused by name: an archive is never
/// extracted halfway, or the router would see an incomplete directory as a scene.
pub(super) struct Limits {
    /// Maximum number of entries read in an archive.
    pub(super) entries: usize,
    /// Maximum total of decompressed bytes written into the cache.
    pub(super) bytes: u64,
}

/// The container ceilings. A marketplace ships kits of several gigabytes; beyond these, it is no
/// longer an asset but a trap archive — a hundred bytes that write a thousand billion, or a
/// million entries that saturate the cache.
pub(super) const LIMITS: Limits = Limits {
    entries: 20_000,
    bytes: 8 * 1024 * 1024 * 1024,
};

/// An entry leaves the extraction directory: absolute path, parent climb, named volume.
pub(super) const PATH_ESCAPE: &str = "ARCHIVE_PATH_ESCAPE";
/// The archive cannot be read: truncated, corrupted, or a compression format this binary does not have.
pub(super) const UNREADABLE: &str = "ARCHIVE_UNREADABLE";
/// The archive is well formed but carries no entry.
pub(super) const EMPTY: &str = "ARCHIVE_EMPTY";
/// The archive is encrypted: circumventing it is forbidden, the compiler refuses and says so.
pub(super) const ENCRYPTED: &str = "ARCHIVE_ENCRYPTED";
/// An entry is a symbolic link: it is never followed, it points outside the extraction.
pub(super) const SYMLINK: &str = "ARCHIVE_SYMLINK";
/// The decompressed total exceeds `LIMITS.bytes`.
pub(super) const TOO_LARGE: &str = "ARCHIVE_TOO_LARGE";
/// The entry count exceeds `LIMITS.entries`.
pub(super) const TOO_MANY_ENTRIES: &str = "ARCHIVE_TOO_MANY_ENTRIES";

/// The extraction directory of an archive, under the compiler cache. The key holds the container
/// name and version and the archive digest: an unchanged archive is never re-extracted, a modified
/// archive never inherits the previous one's files.
pub(super) fn extraction_dir(
    request: &SceneRequest<'_>,
    container: &dyn ScenePlugin,
    digest: &str,
) -> PathBuf {
    let key = hash(format!("{}:{}:{digest}", container.name(), container.version()).as_bytes());
    request.cache.join("native").join("archives").join(key)
}

/// The path of an entry under the extraction root. An absolute entry, one that climbs, that names
/// a volume or that carries a backslash designates a file outside the root: that is directory
/// escape by the archive, refused before any byte is written.
pub(super) fn safe_join(root: &Path, name: &str) -> Result<PathBuf> {
    let refused = || {
        CompilerError::new(
            PATH_ESCAPE,
            format!("archive entry {name:?} escapes the extraction directory"),
        )
    };
    if name.starts_with('/') || name.contains('\\') || name.contains(':') {
        return Err(refused());
    }
    let mut out = root.to_path_buf();
    for part in name.split('/').filter(|part| !part.is_empty()) {
        if !is_safe_source_name(part) {
            return Err(refused());
        }
        out.push(part);
    }
    if out == root {
        return Err(refused());
    }
    Ok(out)
}

/// The only archive this container received. A directory that holds several is an ambiguity: the
/// compiler does not guess which one wraps the scene.
pub(super) fn only_input<'a>(
    request: &SceneRequest<'a>,
    plugin: &dyn ScenePlugin,
) -> Result<&'a Path> {
    let [file] = request.inputs else {
        let kind = plugin.extensions().first().copied().unwrap_or_default();
        return Err(CompilerError::new(
            "SOURCE_FORMAT_AMBIGUOUS",
            format!(
                "{}: a source directory carries exactly one .{kind}, found {}",
                plugin.name(),
                request.inputs.len()
            ),
        ));
    };
    Ok(file)
}

/// Cancellation, to check at each entry: an archive of ten thousand files stops on request.
pub(super) fn check(request: &SceneRequest<'_>) -> Result<()> {
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Compilation cancelled"));
    }
    Ok(())
}

/// The refusal of an archive its reader does not open: truncated, corrupted, or compressed by a
/// method this binary does not ship. The reader's reason travels as-is.
pub(super) fn unreadable(source: &Path, error: impl std::fmt::Display) -> CompilerError {
    CompilerError::new(UNREADABLE, format!("{}: {error}", source.to_string_lossy()))
}

/// The refusal of a well-formed archive that carries no entry.
pub(super) fn empty(source: &Path) -> CompilerError {
    CompilerError::new(
        EMPTY,
        format!("{}: archive is empty", source.to_string_lossy()),
    )
}

/// The entry ceiling, as soon as the reader knows how many the archive holds.
pub(super) fn under_entry_limit(entries: usize) -> Result<()> {
    if entries > LIMITS.entries {
        return Err(CompilerError::new(
            TOO_MANY_ENTRIES,
            format!(
                "archive holds {entries} entries, over the {} allowed",
                LIMITS.entries
            ),
        ));
    }
    Ok(())
}

/// The decompressed-byte ceiling, on the total announced by the index then on the total written:
/// an archive that lies about its entry sizes is stopped by the same count.
pub(super) fn under_byte_limit(bytes: u64) -> Result<()> {
    if bytes > LIMITS.bytes {
        return Err(CompilerError::new(
            TOO_LARGE,
            format!(
                "archive expands past the {} uncompressed bytes allowed",
                LIMITS.bytes
            ),
        ));
    }
    Ok(())
}
