//! The voxel page: bricks of voxels as one page of the geometry pool, the words both engines'
//! shaders read in place (`sdk-browser/src/visibility/shader/voxelWgsl.ts`). The compiler writes it
//! for an HLOD cell's voxel levels; the runtime builds the same words from `voxels.bin`
//! (`sdk-core/src/page/voxelPage.ts`).
//!
//! A page: a head of six words — `T3VP`, its voxel count and, in the high half, its brick count; its
//! corner (`f32` × 3), its voxels' side —, then each brick's record, five words — its mask (two
//! words, bit `x + 4y + 16z`), its corner in bricks from the page's (`u16` × 3), its joint (`u16`,
//! `0xFFFF` for none), the rank in the page of its first voxel —, then each voxel's record, the
//! bricks' voxels in turn, each brick's in its mask's order. A voxel's rank is its brick's first
//! plus the bits of the mask below its own: one read and a popcount. At most `VOXEL_PAGE_BRICKS`
//! bricks: each draws its box, `VOXEL_BRICK_TRIANGLES` triangles on `VOXEL_BRICK_CORNERS` corners,
//! as many as a page's identifier names; each pixel of a box traces the brick's voxels.
use crate::facts::PageFacts;

/// `T3VP` read as a little-endian `u32`: a voxel page's magic.
pub const VOXEL_PAGE_MAGIC: u32 = 0x5056_3354;
/// Words of a voxel page's head and of each brick's record.
pub const VOXEL_PAGE_HEAD_WORDS: usize = 6;
pub const VOXEL_BRICK_WORDS: usize = 5;
/// Bricks a page holds at most: twelve triangles each, 252 of the 256 a page's identifier names.
pub const VOXEL_PAGE_BRICKS: usize = 21;
/// Corners and triangles of a brick's box.
pub const VOXEL_BRICK_CORNERS: usize = 8;
pub const VOXEL_BRICK_TRIANGLES: usize = 12;
/// The geometry descriptor's flag of a voxel page, beside a `WGP3` page's attribute flags.
pub const GEOMETRY_VOXEL: u32 = 0x100;

/// A brick a page is made of: its corner in bricks on its level's grid, its mask, its joint and its
/// voxels' records, one after the other in its mask's order.
pub struct VoxelBrick<'a> {
    pub at: [i32; 3],
    pub mask: u64,
    pub joint: Option<u16>,
    pub records: &'a [u8],
}

/// A voxel page: its bytes, its bricks and voxels, and its box, in its level's units.
#[derive(Clone, Debug)]
pub struct VoxelPage {
    pub bytes: Vec<u8>,
    pub bricks: usize,
    pub voxels: usize,
    pub low: [f64; 3],
    pub high: [f64; 3],
}

impl VoxelPage {
    /// The page's facts: its boxes' corners and triangles, nothing decoded beyond its words.
    pub fn facts(&self) -> PageFacts {
        PageFacts {
            bytes: self.bytes.clone(),
            vertex_count: VOXEL_BRICK_CORNERS * self.bricks,
            index_count: 3 * VOXEL_BRICK_TRIANGLES * self.bricks,
            flags: GEOMETRY_VOXEL,
            decoded_bytes: self.bytes.len(),
            quantization_error: 0.0,
            triangles: VOXEL_BRICK_TRIANGLES * self.bricks,
        }
    }
}

/// The page of `bricks`, of a level of voxels `side` wide: its corner the least of theirs.
pub fn encode_voxel_page(bricks: &[VoxelBrick<'_>], side: f64) -> VoxelPage {
    let first: [i32; 3] =
        std::array::from_fn(|k| bricks.iter().map(|b| b.at[k]).min().unwrap_or(0));
    let voxels: usize = bricks.iter().map(|b| b.mask.count_ones() as usize).sum();
    let records: usize = bricks.iter().map(|b| b.records.len()).sum();
    let words = VOXEL_PAGE_HEAD_WORDS + VOXEL_BRICK_WORDS * bricks.len();
    let mut out = Vec::with_capacity(4 * words + records);
    let word = |out: &mut Vec<u8>, w: u32| out.extend_from_slice(&w.to_le_bytes());
    word(&mut out, VOXEL_PAGE_MAGIC);
    word(&mut out, voxels as u32 | (bricks.len() as u32) << 16);
    for c in first {
        out.extend_from_slice(&((f64::from(c) * 4.0 * side) as f32).to_le_bytes());
    }
    out.extend_from_slice(&(side as f32).to_le_bytes());
    let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
    let mut rank = 0u32;
    for brick in bricks {
        let at: [u32; 3] = std::array::from_fn(|k| (brick.at[k] - first[k]) as u32 & 0xFFFF);
        word(&mut out, brick.mask as u32);
        word(&mut out, (brick.mask >> 32) as u32);
        word(&mut out, at[0] | at[1] << 16);
        word(
            &mut out,
            at[2] | u32::from(brick.joint.unwrap_or(u16::MAX)) << 16,
        );
        word(&mut out, rank);
        rank += brick.mask.count_ones();
        let mut cells = brick.mask;
        while cells != 0 {
            let cell = cells.trailing_zeros() as i32;
            cells &= cells - 1;
            let xyz = [cell & 3, cell >> 2 & 3, cell >> 4];
            for k in 0..3 {
                low[k] = low[k].min(brick.at[k] * 4 + xyz[k]);
                high[k] = high[k].max(brick.at[k] * 4 + xyz[k] + 1);
            }
        }
    }
    for brick in bricks {
        out.extend_from_slice(brick.records);
    }
    VoxelPage {
        bytes: out,
        bricks: bricks.len(),
        voxels,
        low: low.map(|c| f64::from(c) * side),
        high: high.map(|c| f64::from(c) * side),
    }
}
