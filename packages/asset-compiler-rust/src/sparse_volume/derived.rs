//! A volume texture ready to be stored: the pages of every mip level as a list ordered from the
//! coarsest level down, each with its tile and its parent page, the tiles of all the levels shared
//! where they are alike, and those tiles compressed to the voxels that are not the fallback value.
use super::format::*;
use super::texture::TextureData;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hasher};

/// The parent of a page of the coarsest level.
pub(crate) const NO_PARENT: u32 = u32::MAX;

/// The pages of one mip level, in the page list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MipPages {
    pub(crate) offset: u32,
    pub(crate) count: u32,
}

/// A texture's pages and tiles.
pub(crate) struct Derived {
    pub(crate) header: Header,
    pub(crate) tile_count: u32,
    /// The pages of each mip level, indexed by level.
    pub(crate) mips: Vec<MipPages>,
    /// The coordinates of each page in the page table of its level, packed 11, 11 and 10 bits.
    pub(crate) coords: Vec<u32>,
    /// The tile of each page.
    pub(crate) tile_indices: Vec<u32>,
    /// The page of the next coarser level that covers each page.
    pub(crate) parents: Vec<u32>,
    pub(crate) tiles_a: Vec<u8>,
    pub(crate) tiles_b: Vec<u8>,
}

impl Derived {
    /// The pages and tiles of `texture`, whose mip chain is built.
    pub(crate) fn build(texture: &TextureData) -> Self {
        let header = texture.header.clone();
        let levels = texture.mips.len();
        let tile_bytes = [
            VOXELS_PER_PADDED_TILE * header.formats[0].block_bytes(),
            VOXELS_PER_PADDED_TILE * header.formats[1].block_bytes(),
        ];
        let mut mips = vec![
            MipPages {
                offset: 0,
                count: 0
            };
            levels
        ];
        let mut total = 0u32;
        for level in (0..levels).rev() {
            let count = texture.mips[level]
                .page_table
                .iter()
                .filter(|&&entry| entry != 0)
                .count() as u32;
            mips[level] = MipPages {
                offset: total,
                count,
            };
            total += count;
        }
        let mut derived = Self {
            header: header.clone(),
            tile_count: 0,
            mips,
            coords: Vec::with_capacity(total as usize),
            tile_indices: Vec::with_capacity(total as usize),
            parents: Vec::with_capacity(total as usize),
            tiles_a: Vec::new(),
            tiles_b: Vec::new(),
        };
        // The tiles already written, by the fingerprint of their voxels: a tile alike one before it
        // is not written again. Alike is told by the bytes, never by the fingerprint alone.
        let mut shared: HashMap<u64, Vec<u32>> = HashMap::new();
        let mut page_of: Vec<HashMap<u32, u32>> = vec![HashMap::new(); levels];
        for level in (0..levels).rev() {
            let source = &texture.mips[level];
            let resolution = shift_right_and_max(header.page_table_resolution, level as u32, 1);
            for z in 0..resolution[2] {
                for y in 0..resolution[1] {
                    for x in 0..resolution[0] {
                        let entry = source.page_table[linear([x, y, z], resolution)];
                        if entry == 0 {
                            continue;
                        }
                        let from = entry as usize - 1;
                        let a = &source.tiles_a[from * tile_bytes[0]..(from + 1) * tile_bytes[0]];
                        let b = &source.tiles_b[from * tile_bytes[1]..(from + 1) * tile_bytes[1]];
                        let mut hasher = DefaultHasher::new();
                        hasher.write(a);
                        hasher.write(b);
                        let candidates = shared.entry(hasher.finish()).or_default();
                        let alike = candidates.iter().copied().find(|&tile| {
                            let at = tile as usize;
                            derived.tiles_a[at * tile_bytes[0]..(at + 1) * tile_bytes[0]] == *a
                                && derived.tiles_b[at * tile_bytes[1]..(at + 1) * tile_bytes[1]]
                                    == *b
                        });
                        let tile = alike.unwrap_or_else(|| {
                            let written = derived.tile_count;
                            derived.tile_count += 1;
                            derived.tiles_a.extend_from_slice(a);
                            derived.tiles_b.extend_from_slice(b);
                            candidates.push(written);
                            written
                        });
                        let packed = pack_x11y11z10([x, y, z]);
                        page_of[level].insert(packed, derived.coords.len() as u32);
                        derived.coords.push(packed);
                        derived.tile_indices.push(tile);
                        let parent = page_of
                            .get(level + 1)
                            .and_then(|pages| pages.get(&pack_x11y11z10([x / 2, y / 2, z / 2])));
                        derived.parents.push(parent.copied().unwrap_or(NO_PARENT));
                    }
                }
            }
        }
        derived
    }

    /// The tiles compressed to the voxels that are not the fallback value (`CompressedTiles`).
    pub(crate) fn compress(&self) -> Result<CompressedTiles, String> {
        let formats = self.header.formats;
        let sizes = [formats[0].block_bytes(), formats[1].block_bytes()];
        let nulls: [Vec<u8>; 2] = [0, 1].map(|attribute| {
            let mut bytes = vec![0u8; sizes[attribute].max(4)];
            write_voxel(
                0,
                &mut bytes,
                formats[attribute],
                self.header.fallback[attribute],
                None,
            );
            bytes.truncate(sizes[attribute]);
            bytes
        });
        let tiles = self.tile_count as usize;
        // One tile: its occupancy bits, then its voxels, for each texture that holds some.
        let compressed: Vec<(Vec<u8>, [u16; 2])> = (0..tiles)
            .map(|tile| {
                let mut occupancy = [
                    vec![0u32; OCCUPANCY_WORDS_PER_PADDED_TILE],
                    vec![0u32; OCCUPANCY_WORDS_PER_PADDED_TILE],
                ];
                let mut voxels: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
                let mut counts = [0u16; 2];
                for attribute in 0..2 {
                    let size = sizes[attribute];
                    if size == 0 {
                        continue;
                    }
                    let data = if attribute == 0 {
                        &self.tiles_a
                    } else {
                        &self.tiles_b
                    };
                    for voxel in 0..VOXELS_PER_PADDED_TILE {
                        let at = (tile * VOXELS_PER_PADDED_TILE + voxel) * size;
                        let bytes = &data[at..at + size];
                        if bytes != nulls[attribute].as_slice() {
                            occupancy[attribute][voxel / 32] |= 1 << (voxel % 32);
                            voxels[attribute].extend_from_slice(bytes);
                            counts[attribute] += 1;
                        }
                    }
                }
                let mut bytes = Vec::new();
                for attribute in 0..2 {
                    if sizes[attribute] > 0 {
                        bytes.extend(
                            occupancy[attribute]
                                .iter()
                                .flat_map(|word| word.to_le_bytes()),
                        );
                    }
                }
                bytes.extend_from_slice(&voxels[0]);
                bytes.extend_from_slice(&voxels[1]);
                (bytes, counts)
            })
            .collect();
        let mut offsets = Vec::with_capacity(tiles + 1);
        let mut data = Vec::new();
        let mut voxels_a = Vec::with_capacity(tiles);
        for (bytes, counts) in &compressed {
            offsets.push(data.len());
            data.extend_from_slice(bytes);
            voxels_a.push(counts[0]);
        }
        offsets.push(data.len());
        let offsets = offsets
            .into_iter()
            .map(u32::try_from)
            .collect::<Result<Vec<u32>, _>>()
            .map_err(|_| String::from("the tiles take more than four gigabytes once compressed"))?;
        Ok(CompressedTiles {
            offsets,
            voxels_a,
            data,
        })
    }
}

/// The tiles of a texture compressed, one after the other: for each, the occupancy bits of its
/// textures (a bit a voxel, set where the voxel is not the fallback value), then the voxels of
/// the first texture that are set, then those of the second.
pub(crate) struct CompressedTiles {
    /// Where each tile begins in `data`, and, last, where `data` ends.
    pub(crate) offsets: Vec<u32>,
    /// How many voxels of its first texture each tile stores; the second's follow from its size.
    pub(crate) voxels_a: Vec<u16>,
    pub(crate) data: Vec<u8>,
}
