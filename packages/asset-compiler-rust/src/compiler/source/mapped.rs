use crate::*;

pub(crate) enum Binary {
    Mapped(memmap2::Mmap),
    MappedRange(memmap2::Mmap, std::ops::Range<usize>),
    Owned(Vec<u8>),
}
impl Binary {
    pub(crate) fn bytes(&self) -> &[u8] {
        match self {
            Self::Mapped(map) => map,
            Self::MappedRange(map, range) => &map[range.clone()],
            Self::Owned(bytes) => bytes,
        }
    }
    /// The bytes as a vector a pass can grow, with room for `extra` more bytes: the vector itself
    /// when it is owned, else a copy of the mapping — the one rule of making a mapped binary
    /// growable, whose room a pass that appends arrays reserves once.
    pub(crate) fn into_owned(self, extra: usize) -> Result<Vec<u8>> {
        match self {
            Self::Owned(mut bytes) => {
                reserve_more(&mut bytes, extra, "The binary could not be grown")?;
                Ok(bytes)
            }
            mapped => {
                let bytes = mapped.bytes();
                let mut out = reserve(bytes.len().saturating_add(extra))?;
                out.extend_from_slice(bytes);
                Ok(out)
            }
        }
    }
}
/// Maps a source file read-only, the one way every reader maps its input.
pub(crate) fn map_source(path: &Path) -> Result<memmap2::Mmap> {
    let file = File::open(path)?;
    // SAFETY: a read-only map of a source the compiler never writes; a cook assumes its sources
    // are not modified while it runs. Readers take bounds-checked slices of the map only.
    Ok(unsafe { memmap2::MmapOptions::new().map(&file)? })
}
pub(crate) struct RuntimeSource {
    pub(crate) manifest: Value,
    pub(crate) g: Value,
    pub(crate) g_bytes_len: usize,
    pub(crate) binary: Binary,
    pub(crate) bin_hash: String,
    /// The meshes the spline pass made by bending another (`bend_spline_meshes`).
    pub(crate) bent: Vec<usize>,
}
