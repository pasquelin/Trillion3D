//! A mesh's field built: the bricks of each mip measured in parallel, the ones holding a surface's
//! band kept in the order of their cells, and each mip's indirection table naming where they are.
use super::abi::DISTANCE_FIELD_MIPS;
use super::brick::{brick, Brick, BRICK_VOXELS};
use super::grid::Grid;
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
}

/// The cell, `x` fastest, of rank `rank` in a grid of `bricks`.
fn cell(rank: usize, bricks: [usize; 3]) -> [usize; 3] {
    [
        rank % bricks[0],
        (rank / bricks[0]) % bricks[1],
        rank / (bricks[0] * bricks[1]),
    ]
}

/// The field of `scene` at the grid its box and `settings` give.
pub(super) fn build(scene: &Scene, settings: &DistanceFieldSettings) -> Field {
    let grid = Grid::of(scene.low, scene.high, settings, scene.mostly_two_sided);
    let rays = directions();
    let mips = (0..DISTANCE_FIELD_MIPS)
        .map(|index| {
            let mip = grid.mip(index);
            let cells = mip.bricks.iter().product::<usize>();
            let measured: Vec<Brick> = (0..cells)
                .into_par_iter()
                .map(|rank| brick(scene, &mip, &rays, cell(rank, mip.bricks)))
                .collect();
            let (mut indirection, mut voxels) = (vec![NO_BRICK; cells], Vec::new());
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
        two_sided: scene.mostly_two_sided,
        mips,
    }
}
