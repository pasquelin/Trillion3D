//! The grid, the voxel target, solidification, surface bytes. The surface is followed in
//! `follow` from the scene's seed points, then meshed, its crossings found in `crossing`; every
//! value is read on the GPU (`gpu.rs`).
use super::gpu::{Pass, Queries};
use super::marching::corner_offset;
use super::{Scene, LEAST_VOXELS};
use crate::hlod::flatten::units::CENTIMETRES;
use std::sync::atomic::AtomicBool;
use trillion3d_math::geometry::aabb::{centre, longest_side};
use trillion3d_math::vector::vecn::{length, sub};
mod crossing;
mod follow;
use follow::{follow, Followed};

/// The field's values at a list of points, in their order.
type Implicit<'a> = dyn FnMut(&[[f64; 3]]) -> crate::Result<Vec<f32>> + 'a;

/// The marching cubes grid: its least corner, its cell side and its cell counts.
struct Grid {
    origin: [f64; 3],
    cell: f64,
    cells: [i64; 3],
}

impl Grid {
    fn corner(&self, c: [i64; 3]) -> [f64; 3] {
        std::array::from_fn(|k| self.origin[k] + c[k] as f64 * self.cell)
    }
    /// Corner `k` of `cell` (`corner_offset`).
    fn corner_at(cell: [i64; 3], k: usize) -> [i64; 3] {
        let o = corner_offset(k);
        [
            cell[0] + o[0] as i64,
            cell[1] + o[1] as i64,
            cell[2] + o[2] as i64,
        ]
    }
    fn holds(&self, c: [i64; 3]) -> bool {
        (0..3).all(|k| c[k] >= 0 && c[k] < self.cells[k])
    }
}

/// `metres` as centimetres kept in single precision, the width the voxel count and the solid's
/// cell are sized with.
fn centimetres(metres: f64) -> f64 {
    f64::from((metres * CENTIMETRES) as f32)
}

/// The voxel count across `bounds` for `accuracy`: the diagonal over the accuracy, both in
/// centimetres rounded to single precision (`centimetres`) and divided in single precision, then
/// truncated, plus one, at least `LEAST_VOXELS`, then at most `clamp` — an endless diagonal (empty
/// bounds) held at the clamp, never past `usize`.
pub(super) fn voxel_target(
    (low, high): ([f64; 3], [f64; 3]),
    (accuracy, clamp): (f64, usize),
) -> usize {
    let diagonal = centimetres(length(sub(high, low))) as f32;
    let across = f64::from(diagonal / centimetres(accuracy) as f32);
    let cells = if across > clamp as f64 {
        clamp
    } else {
        across as usize
    };
    (cells + 1).max(LEAST_VOXELS).min(clamp)
}

/// How far the solid's grid extends past `bounds` on each end for `accuracy`: twice the accuracy
/// in single-precision centimetres (`centimetres`), in metres.
fn solid_extension(accuracy: f64) -> f64 {
    2.0 * centimetres(accuracy) / CENTIMETRES
}

/// The solid's cell for `bounds` over `target` cells: the largest side, extended on each end
/// (`solid_extension`), so the surface never touches the grid's border.
fn solid_cell((low, high): ([f64; 3], [f64; 3]), accuracy: f64, target: usize) -> f64 {
    (longest_side(low, high) + 2.0 * solid_extension(accuracy)) / target as f64
}

/// The bytes a cell of the surface holds at the widest of the steps, which follow one another and
/// let go of what they read (`approximate`): the simplifier's, its mesh at the closing's full
/// resolution, about one vertex, two triangles and three edges a cell (`approximate/simplify.rs`):
/// - per vertex: its position (24), its edges held in place (40), its quadric (112), two flags (2);
/// - per triangle, twice: its corners (12), its quadric (112), its area (8), a flag (1);
/// - per edge, three times: its ends and triangles (16), its collapse point (24), its mark (4),
///   its heap entry and slot (12), a flag (1);
///
/// 178 + 266 + 171 = 615 bytes, rounded up. The marching (`follow.rs`: its share of the leaves of
/// corner values and of cells met the surface crosses, a crossed cell, an edge and its ends'
/// values, its vertex, two triangles — about 150 bytes; the leaves' slots, a word per 512 nodes of
/// the grid, some 34 MB at 1024 cells across; a front's corner lists read a slice of 2²⁰ cells at
/// a time, some 100 MB whatever the surface)
/// and each pass of the closing (`morphology.rs`: a block of 512 nodes over some 64
/// surface cells, both its meshes — about 200 bytes) hold less. Checked against `hlodEstimateOverPeak`.
pub(super) const SURFACE_CELL_BYTES: usize = 640;

/// The bytes the surface `approximate` makes holds, estimated before it runs, for a solid whose
/// skin shows the grid's axes `skin` square metres (`world.rs`) within `bounds`, at `accuracy`
/// within the voxel `clamp`: every grid is sparse, kept near the surface, so the cells it holds are
/// those its surface crosses on the solid's grid — a face crosses as many cells of a unit grid as
/// the area it shows the three axes, `|nx| + |ny| + |nz|` times its own —, at the voxel count
/// `voxel_target` gives.
pub(crate) fn surface_bytes(
    skin: f64,
    bounds: ([f64; 3], [f64; 3]),
    (accuracy, clamp): (f64, usize),
) -> usize {
    let (low, high) = bounds;
    if !(0..3).all(|k| low[k] <= high[k]) {
        return 0;
    }
    let cell = solid_cell(bounds, accuracy, voxel_target(bounds, (accuracy, clamp)));
    let cells = (skin / (cell * cell)).max(1.0);
    (cells as usize).saturating_mul(SURFACE_CELL_BYTES)
}

/// A solid's surface followed (`solidify`), to be meshed (`Surface::mesh`): its grid, its
/// threshold, the field it is read on — the scene held on the GPU for the crossings — and what the
/// march found (`Followed`).
pub(super) struct Surface<'a> {
    grid: Grid,
    threshold: f64,
    implicit: Box<Implicit<'a>>,
    followed: Followed,
}

impl Surface<'_> {
    /// The cells the surface crosses.
    pub(super) fn cells(&self) -> usize {
        self.followed.1.len()
    }

    /// The surface meshed (`follow::mesh`), the scene let go from the GPU once its crossings are
    /// found.
    pub(super) fn mesh(self) -> crate::Result<(Vec<f32>, Vec<u32>)> {
        let Surface {
            grid,
            threshold,
            mut implicit,
            followed,
        } = self;
        follow::mesh(&grid, threshold, followed, &mut *implicit)
    }
}

/// The solid of `scene` at `accuracy` — where its winding number passes `threshold` or a shell
/// holds the point — its surface followed by marching cubes over `target` cells (`follow`). The
/// scene is packed for the GPU, kept there for the crossings (`Surface::mesh`), and let go; its
/// waits stop when `cancelled` is raised.
pub(super) fn solidify<'a>(
    scene: Scene,
    (accuracy, threshold): (f64, f64),
    target: usize,
    cancelled: &'a AtomicBool,
) -> crate::Result<Surface<'a>> {
    let (low, high) = scene.bounds;
    let extend = solid_extension(accuracy);
    let cell = solid_cell(scene.bounds, accuracy, target);
    let inner_low: [f64; 3] = std::array::from_fn(|k| low[k] - extend);
    let inner_high: [f64; 3] = std::array::from_fn(|k| high[k] + extend);
    // Solid at the boundaries: the grid a tenth of a cell past the bounds, outside there.
    let origin: [f64; 3] = std::array::from_fn(|k| inner_low[k] - 0.1 * cell);
    // The cells across each axis: the width over the cell, truncated, plus one.
    let cells: [i64; 3] = std::array::from_fn(|k| {
        ((inner_high[k] + 0.1 * cell - origin[k]) / cell).trunc() as i64 + 1
    });
    let grid = Grid {
        origin,
        cell,
        cells,
    };
    let middle = centre(low, high);
    let Scene { winding, seeds, .. } = scene;
    let limit = super::gpu::part_bytes()?;
    let parts: Vec<(Vec<u32>, [f64; 3])> = (super::winding::pack(&winding, middle, limit)?)
        .into_iter()
        .map(|words| (words, middle))
        .collect();
    drop(winding);
    let mut queries = Queries::new(Pass::Winding, &parts, cancelled)?;
    drop(parts);
    // Past the bounds the point is outside, read without the GPU.
    let outside = -(threshold + 1.0) as f32;
    let within = move |p: &[f64; 3]| (0..3).all(|k| p[k] >= inner_low[k] && p[k] <= inner_high[k]);
    let mut implicit: Box<Implicit<'a>> =
        Box::new(move |points: &[[f64; 3]]| -> crate::Result<Vec<f32>> {
            let inside: Vec<[f64; 3]> = points.iter().copied().filter(within).collect();
            let mut read = queries.values(&inside)?.into_iter();
            let value = |p: &[f64; 3]| {
                if within(p) {
                    read.next().unwrap_or(outside)
                } else {
                    outside
                }
            };
            Ok(points.iter().map(value).collect())
        });
    let followed = follow(&grid, (&seeds, threshold), &mut *implicit)?;
    Ok(Surface {
        grid,
        threshold,
        implicit,
        followed,
    })
}
