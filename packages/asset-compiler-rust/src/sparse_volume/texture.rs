//! A volume texture in memory: a page table and physical tiles for each mip level, built from the
//! voxels a source gives, its mip chain and its tiles' border voxels generated.
//!
//! The volume is cut in pages of `TILE_RES` voxels a side; a page that holds a voxel other than the
//! fallback value gets a physical tile, whose voxels lie with a border of one voxel around the
//! page's. The page table says, for each page, the rank of its tile plus one; zero is the null
//! tile, which is never stored and reads as the fallback value. Mip `n` halves the volume: its page
//! table is half as wide, a page being the average of the eight pages of mip `n - 1` it covers.
use super::format::*;

mod mips;

/// What a source tells before it gives its voxels.
pub(crate) struct CreateInfo {
    pub(crate) min: IVec3,
    pub(crate) max: IVec3,
    pub(crate) formats: [PixelFormat; 2],
    pub(crate) fallback: [[f32; 4]; 2],
}

/// The voxels of a volume, as a source gives them.
pub(crate) trait Source {
    fn info(&self) -> CreateInfo;
    /// Calls `visit` for each box of voxels (its upper corner excluded) that holds one value for a
    /// component of an attribute texture, with that value.
    fn visit(&self, visit: &mut dyn FnMut(IVec3, IVec3, usize, usize, f32));
}

/// The volume a texture is read as: a coordinate past its sides reads the edge (the importer's
/// texture clamps).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Addressing {
    pub(crate) resolution: IVec3,
}

/// One mip level.
#[derive(Default)]
pub(crate) struct MipMap {
    /// The tile of each page, `x` fastest: its rank plus one, or zero for none.
    pub(crate) page_table: Vec<u32>,
    pub(crate) tiles_a: Vec<u8>,
    pub(crate) tiles_b: Vec<u8>,
    pub(crate) tile_count: usize,
}

/// A volume texture before its tiles are shared and compressed (`derived.rs`).
pub(crate) struct TextureData {
    pub(crate) header: Header,
    /// The fallback values as the formats hold them.
    pub(crate) fallback_quantized: [[f32; 4]; 2],
    pub(crate) mips: Vec<MipMap>,
}

/// The voxel `coord` of a padded tile, `(-1..=16)` on each axis, as its rank in the tile.
fn padded_index(tile: usize, coord: IVec3) -> usize {
    let side = TILE_RES_PADDED as usize;
    let padded = |c: i32| (c + TILE_BORDER) as usize;
    tile * VOXELS_PER_PADDED_TILE
        + (padded(coord[2]) * side + padded(coord[1])) * side
        + padded(coord[0])
}

/// The bytes a fallback value takes in `format`.
fn null_voxel(format: PixelFormat, fallback: [f32; 4]) -> Vec<u8> {
    let mut bytes = vec![0u8; format.block_bytes().max(4)];
    write_voxel(0, &mut bytes, format, fallback, None);
    bytes.truncate(format.block_bytes());
    bytes
}

/// The page of the voxel `coord` in the page table of a header's mip 0.
fn page_index(header: &Header, coord: IVec3) -> usize {
    let page = sub3(map3(coord, |x| x / TILE_RES), header.page_table_min);
    linear(page, header.page_table_resolution)
}

impl TextureData {
    /// The texture of the voxels `source` gives. Why it cannot be one, if it cannot.
    pub(crate) fn create(source: &dyn Source) -> Result<Self, String> {
        let info = source.info();
        let header = Header::new(info.min, info.max, info.formats, info.fallback);
        header.validate()?;
        let mut fallback_quantized = [[0.0; 4]; 2];
        let mut nulls = [Vec::new(), Vec::new()];
        for attribute in 0..2 {
            if header.formats[attribute] != PixelFormat::Unknown {
                nulls[attribute] =
                    null_voxel(header.formats[attribute], header.fallback[attribute]);
                fallback_quantized[attribute] =
                    read_voxel(0, &nulls[attribute], header.formats[attribute]);
            }
        }
        // Tag the pages that hold a voxel other than the fallback value.
        let mut has_data = vec![false; cells(header.page_table_resolution)];
        source.visit(&mut |low, high, attribute, component, value| {
            if value == header.fallback[attribute][component] {
                return;
            }
            let first = sub3(map3(low, |x| x / TILE_RES), header.page_table_min);
            let last = sub3(map3(high, |x| (x - 1) / TILE_RES), header.page_table_min);
            for z in first[2]..=last[2] {
                for y in first[1]..=last[1] {
                    for x in first[0]..=last[0] {
                        has_data[linear([x, y, z], header.page_table_resolution)] = true;
                    }
                }
            }
        });
        let mut mip = MipMap {
            page_table: vec![0; has_data.len()],
            ..MipMap::default()
        };
        let mut allocated = 0u32;
        for (entry, &data) in mip.page_table.iter_mut().zip(&has_data) {
            if data {
                allocated += 1;
                *entry = allocated;
            }
        }
        mip.tile_count = allocated as usize;
        // Every voxel of every tile starts as the fallback value: the voxels the source gives do
        // not reach them all.
        let voxels = mip.tile_count * VOXELS_PER_PADDED_TILE;
        mip.tiles_a = nulls[0].repeat(voxels);
        mip.tiles_b = nulls[1].repeat(voxels);
        let mut texture = Self {
            header,
            fallback_quantized,
            mips: vec![mip],
        };
        source.visit(&mut |low, high, attribute, component, value| {
            for z in low[2]..high[2] {
                for y in low[1]..high[1] {
                    for x in low[0]..high[0] {
                        let coord = [x, y, z];
                        let entry = texture.mips[0].page_table[page_index(&texture.header, coord)];
                        if entry != 0 {
                            let local = map3(coord, |c| c % TILE_RES);
                            texture.write_tile_voxel(
                                entry as usize - 1,
                                local,
                                0,
                                attribute,
                                [value; 4],
                                Some(component),
                            );
                        }
                    }
                }
            }
        });
        Ok(texture)
    }

    /// The page table entry of the page `coord` (in pages, the volume's own origin) of mip `mip`;
    /// none for a page out of the table.
    fn read_page_table(&self, coord: IVec3, mip: usize) -> Option<u32> {
        let level = self.mips.get(mip)?;
        let low = map3(self.header.page_table_min, |x| x >> mip);
        let high = shift_right_and_max(self.header.page_table_max, mip as u32, 1);
        if !in_bounds(coord, low, high) {
            return None;
        }
        level
            .page_table
            .get(linear(sub3(coord, low), sub3(high, low)))
            .copied()
    }

    fn read_tile_voxel(&self, tile: usize, coord: IVec3, mip: usize, attribute: usize) -> [f32; 4] {
        let format = self.header.formats[attribute];
        let level = &self.mips[mip];
        let data = if attribute == 0 {
            &level.tiles_a
        } else {
            &level.tiles_b
        };
        if !in_bounds(coord, [0; 3], [TILE_RES; 3]) || tile >= level.tile_count || data.is_empty() {
            return self.fallback_quantized[attribute];
        }
        read_voxel(padded_index(tile, coord), data, format)
    }

    /// Writes `value` to the voxel `coord` of a tile, which may lie in its border.
    fn write_tile_voxel(
        &mut self,
        tile: usize,
        coord: IVec3,
        mip: usize,
        attribute: usize,
        value: [f32; 4],
        component: Option<usize>,
    ) {
        let format = self.header.formats[attribute];
        let Some(level) = self.mips.get_mut(mip) else {
            return;
        };
        let data = if attribute == 0 {
            &mut level.tiles_a
        } else {
            &mut level.tiles_b
        };
        if !in_bounds(coord, [-TILE_BORDER; 3], [TILE_RES + TILE_BORDER; 3])
            || tile >= level.tile_count
            || data.is_empty()
        {
            return;
        }
        write_voxel(padded_index(tile, coord), data, format, value, component);
    }

    /// The voxel `coord` of mip `mip`, read as `addressing` says for a coordinate past the volume.
    pub(crate) fn load(
        &self,
        coord: IVec3,
        mip: usize,
        attribute: usize,
        addressing: &Addressing,
    ) -> [f32; 4] {
        let wrapped = [0, 1, 2]
            .map(|axis| coord[axis].clamp(0, (addressing.resolution[axis] >> mip).max(1) - 1));
        match self.read_page_table(map3(wrapped, |x| x / TILE_RES), mip) {
            None | Some(0) => self.fallback_quantized[attribute],
            Some(entry) => self.read_tile_voxel(
                entry as usize - 1,
                map3(wrapped, |x| x % TILE_RES),
                mip,
                attribute,
            ),
        }
    }
}
