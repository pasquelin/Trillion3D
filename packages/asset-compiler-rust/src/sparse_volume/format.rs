//! The numbers of a sparse volume texture and the maths on them: the tile and its border, the
//! attribute formats and how a voxel is read and written in each, the header that sizes the
//! volume, its page table and its mip chain.
use half::f16;

/// Voxels along a tile's side, without its border.
pub(crate) const TILE_RES: i32 = 16;
/// Voxels of border around a tile, on each side, so a trilinear read at a tile's edge never leaves it.
pub(crate) const TILE_BORDER: i32 = 1;
/// Voxels along a tile's side, with its border.
pub(crate) const TILE_RES_PADDED: i32 = TILE_RES + 2 * TILE_BORDER;
/// The largest side of a volume texture, whatever the machine the asset is compiled on.
pub(crate) const MAX_VOLUME_TEXTURE_DIM: i32 = 2048;
/// The largest size of one texture resource, in bytes.
pub(crate) const MAX_RESOURCE_SIZE: i64 = 2048 * 1024 * 1024;
/// Voxels of a padded tile.
pub(crate) const VOXELS_PER_PADDED_TILE: usize =
    (TILE_RES_PADDED * TILE_RES_PADDED * TILE_RES_PADDED) as usize;
/// Words of the occupancy bits of a padded tile: one bit a voxel.
pub(crate) const OCCUPANCY_WORDS_PER_PADDED_TILE: usize = VOXELS_PER_PADDED_TILE.div_ceil(32);

/// Three whole numbers: a voxel, a page, a size.
pub(crate) type IVec3 = [i32; 3];

/// Applies `f` to each of the three components.
pub(crate) fn map3(a: IVec3, f: impl Fn(i32) -> i32) -> IVec3 {
    [f(a[0]), f(a[1]), f(a[2])]
}
/// Applies `f` to the components of `a` and `b`, pair by pair.
pub(crate) fn zip3(a: IVec3, b: IVec3, f: impl Fn(i32, i32) -> i32) -> IVec3 {
    [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])]
}
/// The component-wise sum.
pub(crate) fn add3(a: IVec3, b: IVec3) -> IVec3 {
    zip3(a, b, |x, y| x + y)
}
/// The component-wise difference.
pub(crate) fn sub3(a: IVec3, b: IVec3) -> IVec3 {
    zip3(a, b, |x, y| x - y)
}
/// `max(value >> shift, min)` on each component.
pub(crate) fn shift_right_and_max(value: IVec3, shift: u32, min: i32) -> IVec3 {
    map3(value, |x| (x >> shift).max(min))
}
/// Whether `point >= min && point < max` on every component.
pub(crate) fn in_bounds(point: IVec3, min: IVec3, max: IVec3) -> bool {
    (0..3).all(|axis| point[axis] >= min[axis] && point[axis] < max[axis])
}
/// The cells of a dense volume of `resolution`, `x` fastest.
pub(crate) fn cells(resolution: IVec3) -> usize {
    resolution
        .iter()
        .map(|&side| side.max(0) as usize)
        .product()
}
/// The rank of `coord` in a dense volume of `resolution`, `x` fastest.
pub(crate) fn linear(coord: IVec3, resolution: IVec3) -> usize {
    (coord[2] as usize * resolution[1] as usize + coord[1] as usize) * resolution[0] as usize
        + coord[0] as usize
}

/// A page's coordinates packed in 11, 11 and 10 bits.
pub(crate) fn pack_x11y11z10(value: IVec3) -> u32 {
    (value[0] as u32 & 0x7FF)
        | ((value[1] as u32 & 0x7FF) << 11)
        | ((value[2] as u32 & 0x3FF) << 22)
}

/// The formats an attribute texture takes. The codes are the file's (`abi.rs`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum PixelFormat {
    Unknown = 0,
    R8 = 1,
    R8G8 = 2,
    R8G8B8A8 = 3,
    R16F = 4,
    G16R16F = 5,
    FloatRgba = 6,
}

impl PixelFormat {
    /// The bytes of one voxel; none for no texture.
    pub(crate) fn block_bytes(self) -> usize {
        match self {
            Self::Unknown => 0,
            Self::R8 => 1,
            Self::R8G8 | Self::R16F => 2,
            Self::R8G8B8A8 | Self::G16R16F => 4,
            Self::FloatRgba => 8,
        }
    }
}

fn unorm8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0) as u8
}
fn half_bits(value: f32) -> u16 {
    f16::from_f32(value).to_bits()
}
fn half_value(bits: u16) -> f32 {
    f16::from_bits(bits).to_f32()
}
fn half_at(data: &[u8], index: usize) -> f32 {
    half_value(u16::from_le_bytes(
        data[index * 2..index * 2 + 2]
            .try_into()
            .expect("two bytes"),
    ))
}

/// The voxel `index` of `data`, as four numbers; the missing components are zero.
pub(crate) fn read_voxel(index: usize, data: &[u8], format: PixelFormat) -> [f32; 4] {
    let byte = |at: usize| f32::from(data[at]) / 255.0;
    match format {
        PixelFormat::Unknown => [0.0; 4],
        PixelFormat::R8 => [byte(index), 0.0, 0.0, 0.0],
        PixelFormat::R8G8 => [byte(index * 2), byte(index * 2 + 1), 0.0, 0.0],
        PixelFormat::R8G8B8A8 => {
            let at = index * 4;
            [byte(at), byte(at + 1), byte(at + 2), byte(at + 3)]
        }
        PixelFormat::R16F => [half_at(data, index), 0.0, 0.0, 0.0],
        PixelFormat::G16R16F => [
            half_at(data, index * 2),
            half_at(data, index * 2 + 1),
            0.0,
            0.0,
        ],
        PixelFormat::FloatRgba => {
            let at = index * 4;
            [
                half_at(data, at),
                half_at(data, at + 1),
                half_at(data, at + 2),
                half_at(data, at + 3),
            ]
        }
    }
}

/// Writes `value` into the voxel `index` of `data`: all its components, or the one `component`.
pub(crate) fn write_voxel(
    index: usize,
    data: &mut [u8],
    format: PixelFormat,
    value: [f32; 4],
    component: Option<usize>,
) {
    let wants = |c: usize| component.map_or(true, |only| only == c);
    let put_half = |data: &mut [u8], at: usize, c: usize| {
        if wants(c) {
            data[at * 2..at * 2 + 2].copy_from_slice(&half_bits(value[c]).to_le_bytes());
        }
    };
    match format {
        PixelFormat::Unknown => {}
        PixelFormat::R8 => {
            if wants(0) {
                data[index] = unorm8(value[0]);
            }
        }
        PixelFormat::R8G8 => {
            for c in 0..2 {
                if wants(c) {
                    data[index * 2 + c] = unorm8(value[c]);
                }
            }
        }
        PixelFormat::R8G8B8A8 => {
            for c in 0..4 {
                if wants(c) {
                    data[index * 4 + c] = unorm8(value[c]);
                }
            }
        }
        PixelFormat::R16F => put_half(data, index, 0),
        PixelFormat::G16R16F => {
            put_half(data, index * 2, 0);
            put_half(data, index * 2 + 1, 1);
        }
        PixelFormat::FloatRgba => {
            for c in 0..4 {
                put_half(data, index * 4 + c, c);
            }
        }
    }
}

/// The sizes of a volume texture and of its page table.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Header {
    pub(crate) virtual_resolution: IVec3,
    pub(crate) virtual_min: IVec3,
    pub(crate) virtual_max: IVec3,
    pub(crate) page_table_resolution: IVec3,
    pub(crate) page_table_min: IVec3,
    pub(crate) page_table_max: IVec3,
    pub(crate) formats: [PixelFormat; 2],
    pub(crate) fallback: [[f32; 4]; 2],
}

/// A whole number of pages rounded up to a power of two: the page table's sides, so all its mips
/// fit the mips of the texture it is stored in.
fn round_up_to_power_of_two(side: i32) -> i32 {
    (side.max(1) as u32).next_power_of_two() as i32
}

impl Header {
    /// The header of a volume spanning `min` to `max` in voxels (`max` excluded).
    pub(crate) fn new(
        min: IVec3,
        max: IVec3,
        formats: [PixelFormat; 2],
        fallback: [[f32; 4]; 2],
    ) -> Self {
        let mut header = Self {
            virtual_resolution: sub3(max, min),
            virtual_min: min,
            virtual_max: max,
            page_table_resolution: [0; 3],
            page_table_min: map3(min, |x| x / TILE_RES),
            page_table_max: [0; 3],
            formats,
            fallback,
        };
        header.size_page_table(header.page_table_min);
        header
    }

    /// Sets the page table from `origin`, its lowest page: up to the pages the volume reaches, each
    /// side rounded up to a power of two.
    fn size_page_table(&mut self, origin: IVec3) {
        self.page_table_min = origin;
        let reach = map3(self.virtual_max, |x| (x + TILE_RES - 1) / TILE_RES);
        self.page_table_resolution = map3(sub3(reach, origin), round_up_to_power_of_two);
        self.page_table_max = add3(origin, self.page_table_resolution);
    }

    /// Aligns the page table's origin to a power of two, `2^(mips - 1)` pages, so that a mip's
    /// origin is a whole page at every mip level: a shifted one would cut the volume off where its
    /// page table ends.
    pub(crate) fn update_page_table_from_global_mips(&mut self, mips: u32) {
        let alignment = 1_i32 << (mips - 1);
        let origin = map3(self.virtual_min, |x| (x / TILE_RES) / alignment * alignment);
        self.size_page_table(origin);
    }

    /// How many mip levels the page table has: down to one page.
    pub(crate) fn mip_levels(&self) -> u32 {
        let mut resolution = self.page_table_resolution;
        let mut levels = 1;
        while resolution.iter().any(|&side| side > 1) {
            resolution = map3(resolution, |side| side / 2);
            levels += 1;
        }
        levels
    }

    /// Why this header cannot be a texture, if it cannot.
    pub(crate) fn validate(&self) -> Result<(), String> {
        let res = self.page_table_resolution;
        if res.iter().any(|&side| side > MAX_VOLUME_TEXTURE_DIM) {
            return Err(format!(
                "the page table is {}x{}x{} pages, past the limit of {MAX_VOLUME_TEXTURE_DIM}",
                res[0], res[1], res[2]
            ));
        }
        let bytes: i64 = res.iter().map(|&side| i64::from(side)).product::<i64>() * 4;
        if bytes > MAX_RESOURCE_SIZE {
            return Err(format!(
                "the page table is {bytes} bytes, past the limit of {MAX_RESOURCE_SIZE}"
            ));
        }
        Ok(())
    }
}

/// How many mip levels the page table of a volume spanning `min` to `max` has: down to one page.
pub(crate) fn mip_levels(min: IVec3, max: IVec3) -> u32 {
    Header::new(min, max, [PixelFormat::Unknown; 2], [[0.0; 4]; 2]).mip_levels()
}
