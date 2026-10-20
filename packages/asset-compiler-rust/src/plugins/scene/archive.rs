//! Base of the container drivers: a format that does not carry a scene but the wrapping of a
//! source. A container reads no geometry. It extracts under the cache, then yields the extracted
//! directory to the router: an ordinary scene driver produces the intermediate scene, and the
//! container yields nothing other than what that driver yields.
//!
//! This module holds the protections and the identity, which depend on no format: ceilings, named
//! refusals, directory-escape refusal, extraction key. Its `container` submodule holds the common
//! sequence — extract, mark, route. A second container therefore only adds its reading.
use super::*;
use crate::{archives_dir, hash, safe_relative, CompilerError};

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

/// The gzip magic number, that a `.unitypackage` and an older `.blend` start with.
pub(super) const GZIP_MAGIC: &[u8] = b"\x1f\x8b";
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
    archives_dir(request.cache).join(key)
}

/// Marker of a finished extraction, beside the extracted directory and never inside it: until it
/// is written, the directory is a work in progress that nobody rereads, and prune removes it.
pub(crate) const MARKER: &str = "archive.json";

/// The chain of the extraction at `directory` (an `extraction_dir`) once it is finished, or
/// nothing while it must be (re)done.
pub(crate) fn extracted(directory: &Path) -> Option<serde_json::Value> {
    let marker: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join(MARKER)).ok()?).ok()?;
    (marker["status"] == "ready").then(|| marker["chain"].clone())
}

/// The refusal of an entry that names no path under the extraction root — absolute, climbing,
/// naming a volume, carrying a backslash or empty (`safe_relative`, the one rule of a path under
/// a root): directory escape by the archive, refused before any byte is written.
pub(super) fn escape(name: &str) -> CompilerError {
    CompilerError::new(
        PATH_ESCAPE,
        format!("archive entry {name:?} escapes the extraction directory"),
    )
}

/// The only archive this container received. A directory that holds several is an ambiguity: the
/// compiler does not guess which one wraps the scene.
pub(super) fn only_input<'a>(
    request: &SceneRequest<'a>,
    plugin: &dyn ScenePlugin,
) -> Result<&'a Path> {
    let kind = plugin.extensions().first().copied().unwrap_or_default();
    let file = super::single_input(request.inputs, plugin.name(), &format!(".{kind}"))?;
    Ok(file)
}

/// Cancellation, to check at each entry: an archive of ten thousand files stops on request.
pub(super) fn check(request: &SceneRequest<'_>) -> Result<()> {
    super::cancel::check(request.cancelled)
}

/// The refusal of an archive its reader does not open: truncated, corrupted, or compressed by a
/// method this binary does not ship. The reader's reason travels as-is.
pub(super) fn unreadable(source: &Path, error: impl std::fmt::Display) -> CompilerError {
    CompilerError::new(UNREADABLE, format!("{}: {error}", source.to_string_lossy()))
}

/// Writes one entry's payload to `path`, at most one byte past the room the ceiling leaves, and
/// adds it to `written`: an entry that lies about its size is stopped by the same count. The
/// payload is read here: an entry that does not unpack is an unreadable archive, not a disk
/// failure.
pub(super) fn write_entry(
    entry: &mut impl std::io::Read,
    path: &Path,
    written: &mut u64,
    source: &Path,
) -> Result<()> {
    let mut file = std::fs::File::create(path)?;
    let room = LIMITS.bytes - *written;
    *written += std::io::copy(&mut std::io::Read::take(entry, room + 1), &mut file)
        .map_err(|error| unreadable(source, error))?;
    under_byte_limit(*written)
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
