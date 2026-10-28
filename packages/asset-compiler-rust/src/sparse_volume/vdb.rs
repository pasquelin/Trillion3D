//! The reader of a `.vdb` file (the OpenVDB format, file versions 222 and later): its grids, each
//! with its name, the type of its values, its transform, its background value, and the active
//! voxels and tiles of its tree (5, 4, 3 levels, the only tree the importer takes).
//!
//! Read in the order the file writes: the head (magic, version, library version, grid offsets
//! flag, uuid), the file's metadata, the grid count, and for each grid its descriptor then its
//! data — compression flags, metadata, transform, tree topology, tree buffers. Compression is
//! none, zip, or Blosc over LZ4, with or without the active mask (`compress.rs`).
mod compress;
mod cursor;
mod transform;
mod tree;
mod values;

use crate::{CompilerError, Result};
use cursor::Cursor;
pub(crate) use tree::Grid;

/// A file this reader does not read, though it may be a valid one.
pub(super) fn unsupported(what: impl Into<String>) -> CompilerError {
    CompilerError::new("UNSUPPORTED_VDB", what)
}

/// A file that is not a valid one.
pub(super) fn invalid(what: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_SPARSE_VOLUME", what)
}

/// The number the first four bytes of every file hold.
const MAGIC: u32 = 0x5644_4220;
/// The first file version whose compression is chosen per grid, and whose node masks are stored
/// in the form this reader takes.
const FIRST_VERSION: u32 = 222;
/// The version that stores the uuid as a 36-character string.
const UUID_STRING_VERSION: u32 = 218;
/// The separator a grid's name carries before the number that makes it unique.
const NAME_SEPARATOR: char = '\u{1e}';

/// The grids of a file, in the order it holds them. A grid whose values this reader does not take
/// is held with no data (`Grid::supported`), so the indices of the others stay the file's.
pub(crate) struct File {
    pub(crate) grids: Vec<Grid>,
}

/// Reads the file `bytes`.
pub(crate) fn read(bytes: &[u8]) -> Result<File> {
    let mut cursor = Cursor::new(bytes);
    if cursor.u32()? != MAGIC {
        return Err(invalid(
            "the file is not an OpenVDB file: its magic number is wrong",
        ));
    }
    cursor.skip(4)?;
    let version = cursor.u32()?;
    if version < FIRST_VERSION {
        return Err(unsupported(format!(
            "the file is of format version {version}; versions {FIRST_VERSION} and later are read"
        )));
    }
    cursor.skip(8)?; // the library's major and minor version
    cursor.skip(1)?; // whether the file holds the offsets of its grids
    cursor.skip(if version >= UUID_STRING_VERSION {
        36
    } else {
        16
    })?;
    read_metadata(&mut cursor)?;
    let count = cursor.u32()? as usize;
    let mut grids = Vec::with_capacity(count.min(1024));
    for _ in 0..count {
        let name = cursor.string()?;
        let grid_type = cursor.string()?;
        let instance_parent = cursor.string()?;
        cursor.skip(8)?; // where the grid's data begins
        cursor.skip(8)?; // where its buffers begin
        let end = cursor.i64()?;
        if !instance_parent.is_empty() {
            return Err(unsupported(format!(
                "the grid {name:?} shares the tree of the grid {instance_parent:?}"
            )));
        }
        let name = name
            .split(NAME_SEPARATOR)
            .next()
            .unwrap_or_default()
            .to_string();
        grids.push(tree::read_grid(&mut cursor, name, &grid_type, end)?);
        if end > 0 && (end as usize) <= bytes.len() {
            cursor.seek(end as usize);
        }
    }
    Ok(File { grids })
}

/// Reads a metadata map: a count, then for each entry its name, its type and its payload. Returns
/// the entries' names with their payloads.
fn read_metadata(cursor: &mut Cursor) -> Result<Vec<(String, Vec<u8>)>> {
    let count = cursor.u32()? as usize;
    let mut entries = Vec::with_capacity(count.min(256));
    for _ in 0..count {
        let name = cursor.string()?;
        let _type_name = cursor.string()?;
        let size = cursor.u32()? as usize;
        entries.push((name, cursor.bytes(size)?.to_vec()));
    }
    Ok(entries)
}
