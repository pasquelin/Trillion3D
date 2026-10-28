//! `sparseVolumes.bin` and the manifest's `sparseVolumes` section, as the runtime reads them
//! (`packages/sdk-browser/src/lighting/heterogeneousVolumes/sparseVolumeFile.ts`).
//!
//! The file is the frames of the scene's volumes one after the other, each at the offset the
//! section gives, a multiple of four bytes. A frame is little-endian words:
//!
//! - a head of `FRAME_HEAD_WORDS`: the magic, the version, the rank of the first tile that is not
//!   of the coarsest level (the tiles before it are always resident), the mip levels, the pages,
//!   the tiles; the virtual volume's resolution, lowest voxel and highest voxel (excluded); the
//!   page table's resolution, lowest page and highest page (excluded); the two attribute formats
//!   (`PixelFormat` codes) and the two fallback values (four floats each); the bytes of tile data;
//!   a word kept zero;
//! - the pages of each mip level: its first page and its page count;
//! - the pages, three tables of a word each: the page's coordinates in its level's page table (11,
//!   11 and 10 bits), its tile, its parent page (`NO_PARENT` for none);
//! - the tiles' offsets in the tile data, one more than the tiles, the last being the data's bytes;
//! - the voxels each tile stores of its first texture, a half word each, padded to a word;
//! - the tile data: for each tile, the occupancy bits of its textures (732 bytes each, a bit a
//!   voxel of the padded tile, set where it is not the fallback value), then the voxels of its
//!   first texture that are set, then those of its second.
pub(crate) const SPARSE_VOLUMES_FILE: &str = "sparseVolumes.bin";
/// The number every frame starts with: `SVTF`.
pub(crate) const FRAME_MAGIC: u32 = 0x4654_5653;
pub(crate) const FRAME_VERSION: u32 = 1;
/// Words of a frame's head.
pub(crate) const FRAME_HEAD_WORDS: usize = 36;
/// The version of the manifest's section.
pub(crate) const SECTION_VERSION: u32 = 1;
