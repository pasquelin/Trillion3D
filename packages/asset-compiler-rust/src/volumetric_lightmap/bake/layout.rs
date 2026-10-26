//! Where a volumetric lightmap puts its bricks: the volume that covers the importance boxes, cut
//! in a grid of top-level cells, and below each cell a brick at every level the scene's geometry
//! asks for. Three steps, as the reference takes them:
//! - the volume's size and the indirection volume's, one texel a brick of the finest level;
//! - the levels' voxel volumes: the finest holds the cells the geometry touches, each coarser
//!   level every cell with a touched cell below it, the coarsest every cell, so that no part of
//!   the volume is left without a brick;
//! - the bricks, one for each voxel of every level, sorted coarse level first and by Morton code
//!   inside a level, and the indirection volume, each texel naming the finest brick over it.
use super::sampling::Vec3;
use super::settings::{BakeSettings, BRICK_SIZE};
use super::store::Store;
use super::voxelize::{voxelize, Cube};
use crate::volumetric_lightmap::format::VOLUMETRIC_LIGHTMAP_MAX_LAYOUT;
use std::sync::atomic::{AtomicU8, Ordering};

/// A cell of a voxel volume that holds no brick.
pub const NOT_ALLOCATED: u8 = 0;
/// A cell the geometry touches, or a coarser cell with such a cell below it.
pub const ALLOCATED: u8 = 1;
/// A finest cell inside the importance boxes the geometry has not touched.
pub const IN_IMPORTANCE: u8 = 3;
/// Texels along a padded brick's side.
pub const PADDED: u32 = BRICK_SIZE + 1;

/// A brick: where it lies in its level's voxel volume and how many finest bricks it spans.
#[derive(Clone, Copy)]
pub struct Brick {
    pub position: [u32; 3],
    pub span: u32,
}

/// A level's voxel volume: its size and, for each cell, its brick's rank plus one (0: none).
#[derive(Clone)]
pub struct Level {
    pub dims: [u32; 3],
    pub cells: Vec<u32>,
}

pub struct Layout {
    pub volume_min: Vec3,
    pub volume_size: Vec3,
    pub indirection_dims: [u32; 3],
    pub levels: Vec<Level>,
    pub bricks: Vec<Brick>,
    /// The bricks the atlas holds along each side.
    pub layout_dims: [u32; 3],
    /// Per indirection texel: the brick's place in the layout (three bytes) and its span.
    pub indirection: Vec<[u8; 4]>,
}

/// The box of a set of boxes.
pub fn union(boxes: &[(Vec3, Vec3)]) -> (Vec3, Vec3) {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for (a, b) in boxes {
        for k in 0..3 {
            low[k] = low[k].min(a[k]);
            high[k] = high[k].max(b[k]);
        }
    }
    (low, high)
}

fn morton(v: u32) -> u64 {
    let mut x = u64::from(v) & 0x1f_ffff;
    x = (x | (x << 32)) & 0x1f00_0000_ffff;
    x = (x | (x << 16)) & 0x1f_0000_ff00_00ff;
    x = (x | (x << 8)) & 0x100f_00f0_0f00_f00f;
    x = (x | (x << 4)) & 0x10c3_0c30_c30c_30c3;
    (x | (x << 2)) & 0x1249_2492_4924_9249
}

/// A brick's place in the layout of `VOLUMETRIC_LIGHTMAP_MAX_LAYOUT` bricks a side, from its rank.
pub fn layout_position(rank: u32) -> [u32; 3] {
    [
        rank % VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
        (rank / VOLUMETRIC_LIGHTMAP_MAX_LAYOUT) % VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
        rank / VOLUMETRIC_LIGHTMAP_MAX_LAYOUT / VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
    ]
}

/// The atlas texel where the padded brick of rank `rank` starts.
pub fn brick_origin(rank: usize) -> [usize; 3] {
    layout_position(rank as u32).map(|p| (p * PADDED) as usize)
}

/// The texel `inside` of the brick that starts at `origin` (`brick_origin`).
pub fn texel_in(store: &Store, origin: [usize; 3], inside: [u32; 3]) -> usize {
    store.index(std::array::from_fn(|a| origin[a] + inside[a] as usize))
}

/// The texel `inside` of the padded brick of rank `rank`.
pub fn texel_index(store: &Store, rank: usize, inside: [u32; 3]) -> usize {
    texel_in(store, brick_origin(rank), inside)
}

/// The place `k` names in a cube of `side` texels, x then y then z.
pub fn unflatten(k: u32, side: u32) -> [u32; 3] {
    [k % side, (k / side) % side, k / side / side]
}

/// Calls `visit` with every place of a padded brick, x then y then z.
pub fn each_texel(mut visit: impl FnMut([u32; 3])) {
    (0..PADDED.pow(3)).for_each(|k| visit(unflatten(k, PADDED)));
}

/// The bricks the atlas holds along each side for `count` bricks.
pub(super) fn layout_dimensions(count: u32) -> [u32; 3] {
    let mut left = count;
    let mut dims = [0; 3];
    for side in &mut dims {
        *side = left.min(VOLUMETRIC_LIGHTMAP_MAX_LAYOUT);
        left = left.div_ceil(*side);
    }
    dims
}

/// The rank of the cell `p` in a volume of `dims`, x then y then z.
pub fn index(dims: [u32; 3], p: [u32; 3]) -> usize {
    p[0] as usize + dims[0] as usize * (p[1] as usize + dims[1] as usize * p[2] as usize)
}

/// The finest level's voxel volume: the cells inside an expanded importance box are
/// `IN_IMPORTANCE`, then the geometry's triangles allocate the ones they touch.
fn finest_volume(
    dims: [u32; 3],
    cube: &Cube,
    (boxes, expand): (&[(Vec3, Vec3)], f64),
    triangles: &[f32],
) -> Vec<AtomicU8> {
    let total = dims.iter().map(|&d| d as usize).product::<usize>();
    let state: Vec<AtomicU8> = (0..total).map(|_| AtomicU8::new(NOT_ALLOCATED)).collect();
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                let corner = cube.corner([x, y, z]);
                let inside = boxes.iter().any(|(low, high)| {
                    (0..3).all(|k| corner[k] >= low[k] - expand && corner[k] <= high[k] + expand)
                });
                if inside {
                    state[index(dims, [x, y, z])].store(IN_IMPORTANCE, Ordering::Relaxed);
                }
            }
        }
    }
    voxelize(triangles, cube, dims, &state);
    state
}

/// Each coarser level's voxels from the one below: allocated where any of its cells below is,
/// and the coarsest everywhere.
fn coarser_volumes(finest: Vec<u8>, dims: [u32; 3], levels: u32) -> Vec<(Vec<u8>, [u32; 3])> {
    let mut volumes = vec![(finest, dims)];
    for level in 1..levels {
        let (below, below_dims) = &volumes[level as usize - 1];
        let here = below_dims.map(|d| d / BRICK_SIZE);
        let mut cells = vec![NOT_ALLOCATED; here.iter().map(|&d| d as usize).product()];
        let top = level == levels - 1;
        for z in 0..here[2] {
            for y in 0..here[1] {
                for x in 0..here[0] {
                    let touched =
                        top || children(*below_dims, [x, y, z]).any(|c| below[c] == ALLOCATED);
                    if touched {
                        cells[index(here, [x, y, z])] = ALLOCATED;
                    }
                }
            }
        }
        volumes.push((cells, here));
    }
    volumes
}

/// The indices of the cells of the level below that lie under cell `p`.
fn children(below: [u32; 3], p: [u32; 3]) -> impl Iterator<Item = usize> {
    let n = BRICK_SIZE;
    (0..n * n * n).map(move |k| {
        let c = [k % n, (k / n) % n, k / n / n];
        index(below, [p[0] * n + c[0], p[1] * n + c[1], p[2] * n + c[2]])
    })
}

/// The grid of the volume for the importance boxes `boxes`: its lower corner, its sizes in
/// detail cells, then in indirection texels and in metres.
fn grid(low: Vec3, high: Vec3, settings: &BakeSettings) -> (Vec3, [u32; 3], Vec3) {
    let levels = settings.max_refinement_levels;
    let per_top = BRICK_SIZE.pow(levels);
    let cell = settings.detail_cell_size;
    let full = [0, 1, 2].map(|k| ((high[k] - low[k]) / cell).trunc() as u32 + 1);
    let top = full.map(|f| f.div_ceil(per_top));
    let dims = top.map(|t| t * per_top / BRICK_SIZE);
    let size = top.map(|t| f64::from(t * per_top) * cell);
    (low, dims, size)
}

impl Layout {
    /// Whether the brick of rank `rank` is of the finest level.
    pub fn is_finest(&self, rank: usize) -> bool {
        self.bricks[rank].span == 1
    }

    /// The ranks of the finest level's bricks.
    pub fn finest(&self) -> Vec<usize> {
        (0..self.bricks.len())
            .filter(|&r| self.is_finest(r))
            .collect()
    }

    /// The layout of the importance boxes, none when the geometry asks for no brick.
    pub fn build(
        settings: &BakeSettings,
        boxes: &[(Vec3, Vec3)],
        triangles: &[f32],
    ) -> Option<Self> {
        let (low, high) = union(boxes);
        let (volume_min, dims, volume_size) = grid(low, high, settings);
        let cube = Cube::new(volume_min, volume_size, dims);
        let expand = 2.0 * settings.detail_cell_size;
        let finest: Vec<u8> = finest_volume(dims, &cube, (boxes, expand), triangles)
            .into_iter()
            .map(AtomicU8::into_inner)
            .collect();
        let volumes = coarser_volumes(finest, dims, settings.max_refinement_levels);
        let (levels, bricks) = rank_bricks(volumes);
        if bricks.is_empty() {
            return None;
        }
        let layout_dims = layout_dimensions(bricks.len() as u32);
        let indirection = super::indirection::splat(dims, &levels, &bricks);
        Some(Self {
            volume_min,
            volume_size,
            indirection_dims: dims,
            levels,
            bricks,
            layout_dims,
            indirection,
        })
    }
}

/// The bricks of every voxel the levels allocate, sorted coarse first and by Morton code, and
/// the levels with each voxel naming its brick.
fn rank_bricks(volumes: Vec<(Vec<u8>, [u32; 3])>) -> (Vec<Level>, Vec<Brick>) {
    let top = volumes.len() as u32 - 1;
    let mut requests: Vec<(u32, u64, [u32; 3])> = Vec::new();
    for (level, (cells, dims)) in volumes.iter().enumerate() {
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    if cells[index(*dims, [x, y, z])] == ALLOCATED {
                        let code = morton(x) | (morton(y) << 1) | (morton(z) << 2);
                        requests.push((top - level as u32, code, [x, y, z]));
                    }
                }
            }
        }
    }
    requests.sort_unstable_by_key(|&(coarse, code, _)| (coarse, code));
    let mut levels: Vec<Level> = volumes
        .iter()
        .map(|(_, dims)| Level {
            dims: *dims,
            cells: vec![0; dims.iter().map(|&d| d as usize).product()],
        })
        .collect();
    let bricks = requests
        .iter()
        .enumerate()
        .map(|(rank, &(coarse, _, position))| {
            let level = (top - coarse) as usize;
            let at = index(levels[level].dims, position);
            levels[level].cells[at] = rank as u32 + 1;
            Brick {
                position,
                span: BRICK_SIZE.pow(level as u32),
            }
        })
        .collect();
    (levels, bricks)
}
