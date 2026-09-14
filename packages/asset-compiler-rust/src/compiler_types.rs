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
pub(super) struct RuntimeSource {
    pub(super) manifest: Value,
    pub(super) manifest_bytes: Vec<u8>,
    pub(super) g: Value,
    pub(super) g_bytes: Vec<u8>,
    pub(super) binary: Binary,
    pub(super) bin_hash: String,
}
