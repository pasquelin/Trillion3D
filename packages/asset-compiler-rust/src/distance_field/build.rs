//! A mesh's field built: the bricks of each mip measured on the GPU (`gpu.rs`) or, where it cannot,
//! in parallel on the CPU, the ones holding a surface's band kept in the order of their cells, and
//! each mip's indirection table naming where they are.
use super::abi::DISTANCE_FIELD_MIPS;
use super::brick::{brick, Brick, BRICK_VOXELS};
use super::gpu;
use super::grid::{Grid, MipGrid};
use super::samples::directions;
use super::scene::Scene;
use super::DistanceFieldSettings;
use rayon::prelude::*;

/// What a cell of the indirection table holds when its brick is not stored.
pub(super) const NO_BRICK: u32 = u32::MAX;

/// One mip of a field.
pub(super) struct Mip {
    /// The bricks along each axis.
    pub bricks: [usize; 3],
    /// The distance scale and bias, the volume-to-virtual-UV scale and add (`MipGrid`).
    pub scale_bias: [f64; 2],
    pub uv_scale: [f64; 3],
    pub uv_add: [f64; 3],
    /// Per cell, `z` then `y` then `x`, the rank of its brick among those stored, or `NO_BRICK`.
    pub indirection: Vec<u32>,
    /// The stored bricks' voxels, one after the other.
    pub voxels: Vec<u8>,
}

impl Mip {
    /// The bricks stored.
    pub(super) fn stored(&self) -> usize {
        self.voxels.len() / BRICK_VOXELS
    }
}

/// A mesh's field: its box and its mips, finest first.
pub(super) struct Field {
    pub low: [f64; 3],
    pub high: [f64; 3],
    pub two_sided: bool,
    pub mips: Vec<Mip>,
    /// Why its voxels were measured on the CPU rather than the GPU, none when on the GPU: told in
    /// the stage's report, so a slower build is never silent.
    pub on_cpu: Option<String>,
    /// The voxels the GPU measured in doubt and the CPU measured again in double precision.
    pub remeasured: usize,
}

/// The cell, `x` fastest, of rank `rank` in a grid of `bricks`.
pub(super) fn cell(rank: usize, bricks: [usize; 3]) -> [usize; 3] {
    [
        rank % bricks[0],
        (rank / bricks[0]) % bricks[1],
        rank / (bricks[0] * bricks[1]),
    ]
}

/// The grid of `scene`'s box at `settings` and its mips' placements.
pub(super) fn grids(scene: &Scene, settings: &DistanceFieldSettings) -> (Grid, Vec<MipGrid>) {
    let grid = Grid::of(scene.low, scene.high, settings, scene.mostly_two_sided);
    let mips = (0..DISTANCE_FIELD_MIPS)
        .map(|index| grid.mip(index))
        .collect();
    (grid, mips)
}

/// Every brick of every mip of `scene`, cell after cell, measured along `rays` on the CPU, in
/// parallel.
pub(super) fn on_cpu(scene: &Scene, mips: &[MipGrid], rays: &[[f64; 3]]) -> Vec<Vec<Brick>> {
    (mips.iter())
        .map(|mip| {
            (0..mip.cells())
                .into_par_iter()
                .map(|rank| brick(scene, mip, rays, cell(rank, mip.bricks)))
                .collect()
        })
        .collect()
}

/// The field of the mips `mips` of `grid`, their bricks `measured`: those holding a surface's
/// band stored in the order of their cells.
pub(super) fn assemble(
    (grid, mips): (&Grid, &[MipGrid]),
    measured: Vec<Vec<Brick>>,
    two_sided: bool,
) -> Field {
    let mips = (mips.iter().zip(measured))
        .map(|(mip, measured)| {
            let (mut indirection, mut voxels) = (vec![NO_BRICK; measured.len()], Vec::new());
            let mut stored = 0u32;
            for (slot, measured) in indirection.iter_mut().zip(measured) {
                if measured.stored() {
                    *slot = stored;
                    stored += 1;
                    voxels.extend(measured.voxels);
                }
            }
            Mip {
                bricks: mip.bricks,
                scale_bias: mip.scale_bias(),
                uv_scale: mip.uv_scale,
                uv_add: mip.uv_add,
                indirection,
                voxels,
            }
        })
        .collect();
    Field {
        low: grid.low,
        high: grid.high,
        two_sided,
        mips,
        on_cpu: None,
        remeasured: 0,
    }
}

/// The field of `scene` at the grid its box and `settings` give: its voxels measured on the GPU,
/// or on the CPU when the GPU cannot (no adapter, a scene past one binding, a failed batch) — the
/// same field, byte for byte (`gpu.rs`), the reason told when it is the CPU's.
pub(super) fn build(scene: &Scene, settings: &DistanceFieldSettings) -> Field {
    let (grid, mips) = grids(scene, settings);
    let rays = directions();
    let (measured, reason, remeasured) = match gpu::measure(scene, &mips, &rays) {
        Ok((measured, remeasured)) => (measured, None, remeasured),
        Err(refused) => (on_cpu(scene, &mips, &rays), Some(refused.to_string()), 0),
    };
    Field {
        on_cpu: reason,
        remeasured,
        ..assemble((&grid, &mips), measured, scene.mostly_two_sided)
    }
}
