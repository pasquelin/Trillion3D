//! Reading a ZIP archive, shared by the containers whose output format it is — `.zip` itself and
//! `.usdz`, which is an uncompressed and aligned ZIP.
//!
//! Decompression only: only `deflate` is compiled. An encrypted archive is refused, never
//! circumvented.
use super::*;
use ::zip::ZipArchive;
use std::fs;

/// Local-entry header: every archive that holds at least one file starts there.
const LOCAL_FILE_HEADER: &[u8] = b"PK\x03\x04";
/// End of the central directory: it alone is a whole empty archive, recognised so it is refused
/// by saying so rather than ignored by the router.
const END_OF_CENTRAL_DIRECTORY: &[u8] = b"PK\x05\x06";

/// Are these leading bytes those of a ZIP archive?
pub(in super::super) fn accepts_head(head: &[u8]) -> bool {
    head.starts_with(LOCAL_FILE_HEADER) || head.starts_with(END_OF_CENTRAL_DIRECTORY)
}

/// The archive as `open` yields it: its central directory read, once.
pub(in super::super) type Opened = ZipArchive<std::io::BufReader<fs::File>>;

/// Extracts the archive `open` read from `source` under `root` and yields the entry count and
/// the decompressed total. A driver that judged the archive before extracting it hands over the
/// one it opened: the central directory is read once.
///
/// Two passes: the first judges the whole archive on its index — directory escape, symbolic
/// link, encryption, ceilings — the second writes. A refused archive therefore leaves no file
/// behind, and an archive that lies about the announced size of its entries is stopped at write
/// time by the same ceiling.
pub(in super::super) fn extract(
    request: &SceneRequest<'_>,
    mut archive: Opened,
    source: &Path,
    root: &Path,
) -> Result<(usize, u64)> {
    if archive.is_empty() {
        return Err(empty(source));
    }
    under_entry_limit(archive.len())?;
    let mut declared = 0u64;
    for index in 0..archive.len() {
        check(request)?;
        let entry = archive
            .by_index_raw(index)
            .map_err(|error| unreadable(source, error))?;
        if entry.encrypted() {
            return Err(CompilerError::new(
                ENCRYPTED,
                format!("archive entry {:?} is encrypted", entry.name()),
            ));
        }
        if entry.is_symlink() {
            return Err(CompilerError::new(
                SYMLINK,
                format!("archive entry {:?} is a symbolic link", entry.name()),
            ));
        }
        safe_relative(entry.name(), &['/']).ok_or_else(|| escape(entry.name()))?;
        declared = declared.saturating_add(entry.size());
        under_byte_limit(declared)?;
    }
    let mut written = 0u64;
    for index in 0..archive.len() {
        check(request)?;
        let mut entry = archive
            .by_index(index)
            .map_err(|error| unreadable(source, error))?;
        let name = safe_relative(entry.name(), &['/']).ok_or_else(|| escape(entry.name()))?;
        let path = root.join(name);
        if entry.is_dir() {
            fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_entry(&mut entry, &path, &mut written, source)?;
    }
    Ok((archive.len(), written))
}

/// Opens the central directory. A truncated, corrupted archive, or one compressed by a method
/// this binary does not ship, stops here, named, without having written anything.
pub(in super::super) fn open(source: &Path) -> Result<Opened> {
    let file = std::io::BufReader::new(fs::File::open(source)?);
    ZipArchive::new(file).map_err(|error| unreadable(source, error))
}
