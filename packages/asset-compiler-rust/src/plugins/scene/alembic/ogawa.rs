//! The Ogawa container, read here from Alembic's public specification and its reference sources
//! (BSD-3-Clause, `lib/Alembic/Ogawa`): no third-party library, no vendor SDK.
//!
//! An Ogawa file is a tree of two kinds of blocks, designated by a sixty-four-bit integer whose
//! high bit names the kind: a **group** — a child count, then that many pointers — and a **data**
//! block — a length, then its bytes. The header is sixteen bytes: `Ogawa`, a freeze flag, the
//! format version, the root-group position.
//!
//! Everything read here is bounded twice: by the file size, and by a named ceiling. A corrupted
//! pointer therefore neither panics nor allocates a gigabyte — it yields a named refusal.
use super::{FILE_INVALID, HDF5_UNSUPPORTED, NOT_FROZEN, SIZE_UNSUPPORTED, VERSION_UNSUPPORTED};
use crate::{CompilerError, Result};
use memmap2::Mmap;
use std::{fs::File, path::Path};

/// The five bytes that open every Ogawa file.
pub(super) const MAGIC: &[u8] = b"Ogawa";
/// The HDF5 container header, Alembic's historical wrapping, which this driver does not read.
const HDF5_MAGIC: &[u8] = b"\x89HDF";
/// The byte the writer writes when closing the archive: it is then complete, therefore readable.
const FROZEN: u8 = 0xff;
/// The only format version this reader reads, and the only one the format has published.
const VERSION: u16 = 1;
/// The bit that distinguishes a data block from a group in a child pointer.
const DATA_BIT: u64 = 0x8000_0000_0000_0000;
/// The rest of the pointer: the block address in the file.
const ADDRESS: u64 = 0x7fff_ffff_ffff_ffff;
/// Children at most in a group. A healthy file counts a few dozen per object; beyond that, it is
/// a corrupted address read as a count, and reading it would allocate megabytes for nothing.
const MAX_CHILDREN: u64 = 1 << 22;
/// Bytes at most in a data block read at once — a geometry sample, not a scene.
const MAX_DATA_BYTES: u64 = 1 << 30;

/// An Ogawa file opened read-only, mapped in memory.
pub(super) struct Ogawa {
    map: Mmap,
    /// The Alembic format version the header declares.
    pub(super) version: u16,
    /// The root group: the six blocks every Alembic archive holds.
    pub(super) root: Vec<u64>,
}

/// The refusal of a file whose structure does not hold: truncated, corrupted, or not Ogawa.
pub(super) fn invalid(what: impl Into<String>) -> CompilerError {
    CompilerError::new(FILE_INVALID, what.into())
}

/// Does this pointer designate a data block rather than a group?
pub(super) fn is_data(child: u64) -> bool {
    child & DATA_BIT != 0
}

fn read_u64(bytes: &[u8], at: u64) -> Option<u64> {
    let at = usize::try_from(at).ok()?;
    let slice = bytes.get(at..at.checked_add(8)?)?;
    Some(u64::from_le_bytes(slice.try_into().ok()?))
}

impl Ogawa {
    /// Opens the file and reads its header. The source is never modified.
    pub(super) fn open(path: &Path) -> Result<Ogawa> {
        let file = File::open(path)?;
        // SAFETY: read-only mapping of a file the compiler never writes, as for any other source;
        // the reads that follow are bounded by `map.len()`.
        let map = unsafe { memmap2::MmapOptions::new().map(&file)? };
        let name = path.display();
        if map.starts_with(HDF5_MAGIC) {
            return Err(CompilerError::new(
                HDF5_UNSUPPORTED,
                format!("{name}: this Alembic file uses the HDF5 container, which this build does not read; re-export it as Ogawa"),
            ));
        }
        if !map.starts_with(MAGIC) {
            return Err(invalid(format!("{name}: no Ogawa header")));
        }
        // The three bytes after `Ogawa`: the freeze flag, then the version on sixteen bits
        // big-endian — the format writes `00 01` for version one, which reading backwards would
        // yield two hundred and fifty-six.
        let Some(&[frozen, high, low]) = map.get(5..8) else {
            return Err(invalid(format!("{name}: header is truncated")));
        };
        if frozen != FROZEN {
            return Err(CompilerError::new(
                NOT_FROZEN,
                format!("{name}: this Alembic archive was never frozen; the writer left it open, and what it holds is a work in progress"),
            ));
        }
        let version = u16::from_be_bytes([high, low]);
        if version != VERSION {
            return Err(CompilerError::new(
                VERSION_UNSUPPORTED,
                format!("{name}: this Alembic archive declares format version {version}; this reader reads version {VERSION}"),
            ));
        }
        let root_at =
            read_u64(&map, 8).ok_or_else(|| invalid(format!("{name}: header is truncated")))?;
        let mut archive = Ogawa {
            map,
            version,
            root: Vec::new(),
        };
        archive.root = archive.read_group(root_at)?;
        Ok(archive)
    }

    /// The children of the group at this address. An empty group is noted by address zero.
    fn read_group(&self, at: u64) -> Result<Vec<u64>> {
        let at = at & ADDRESS;
        if at == 0 {
            return Ok(Vec::new());
        }
        let count = read_u64(&self.map, at)
            .ok_or_else(|| invalid("a group pointer falls outside the file"))?;
        if count > MAX_CHILDREN {
            return Err(CompilerError::new(
                SIZE_UNSUPPORTED,
                format!(
                    "an Ogawa group declares {count} children, above the {MAX_CHILDREN} ceiling"
                ),
            ));
        }
        (0..count)
            .map(|index| {
                read_u64(&self.map, at + 8 + 8 * index)
                    .ok_or_else(|| invalid("a group is truncated by the end of the file"))
            })
            .collect()
    }

    /// The children of the group this pointer designates. A data block read as a group is a refusal.
    pub(super) fn group(&self, child: u64) -> Result<Vec<u64>> {
        if is_data(child) {
            return Err(invalid(
                "a data block is referenced where a group is expected",
            ));
        }
        self.read_group(child)
    }

    /// The bytes of the data block this pointer designates, without its length.
    pub(super) fn data(&self, child: u64) -> Result<&[u8]> {
        if !is_data(child) {
            return Err(invalid(
                "a group is referenced where a data block is expected",
            ));
        }
        let at = child & ADDRESS;
        if at == 0 {
            return Ok(&[]);
        }
        let size = read_u64(&self.map, at)
            .ok_or_else(|| invalid("a data pointer falls outside the file"))?;
        if size > MAX_DATA_BYTES {
            return Err(CompilerError::new(
                SIZE_UNSUPPORTED,
                format!(
                    "an Ogawa data block declares {size} bytes, above the {MAX_DATA_BYTES} ceiling"
                ),
            ));
        }
        let start = usize::try_from(at + 8).map_err(|_| invalid("data address out of range"))?;
        let length = usize::try_from(size).map_err(|_| invalid("data length out of range"))?;
        self.map
            .get(start..start.saturating_add(length))
            .ok_or_else(|| invalid("a data block is truncated by the end of the file"))
    }

    /// The file size, published in the provenance report.
    pub(super) fn bytes(&self) -> usize {
        self.map.len()
    }
}
