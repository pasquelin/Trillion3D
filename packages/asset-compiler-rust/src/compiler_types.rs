use super::*;

pub(super) enum Binary {
    Mapped(memmap2::Mmap),
    Owned(Vec<u8>),
}
impl Binary {
    pub(super) fn bytes(&self) -> &[u8] {
        match self {
            Self::Mapped(map) => map,
            Self::Owned(bytes) => bytes,
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
pub(super) struct RuntimeSource {
    pub(super) manifest: Value,
    pub(super) manifest_bytes: Vec<u8>,
    pub(super) g: Value,
    pub(super) g_bytes: Vec<u8>,
    pub(super) binary: Binary,
    pub(super) bin_hash: String,
}
