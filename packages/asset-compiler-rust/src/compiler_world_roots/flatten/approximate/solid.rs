//! The grid, the march, bisection, the voxel target, solidification, surface bytes.
use super::super::first_seen::first_seen;
use super::super::grid_key::{self, edge_ends, key, unkey};
use super::super::marching::{corner_offset, triangles, EDGES};
use super::{Scene, SEARCH_STEPS, VOXEL_DIMENSION, WINDING_THRESHOLD};
use rayon::prelude::*;
use trillion3d_math::aabb::longest_side;
use trillion3d_math::vecn::{length, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// The marching cubes grid: its least corner, its cell side and its cell counts.
struct Grid {
    pub(super) origin: [f64; 3],
    pub(super) cell: f64,
    pub(super) cells: [i64; 3],
}

impl Grid {
    pub(super) fn corner(&self, c: [i64; 3]) -> [f64; 3] {
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

/// The surface `field` crosses `WINDING_THRESHOLD` on, followed from the cells holding `seeds`
/// (marching cubes by continuation): front after front, each front's
/// corner values computed side by side, every crossed cell's neighbours across its faces the next
/// front. `refine` finds the crossing between two corners. Each step runs side by side and keeps
/// the order one pass over the cells would give (`first_seen`): the cells, the vertices and the
/// triangles come out the same whatever the threads.
fn march(
    grid: &Grid,
    seeds: &[[f64; 3]],
    field: &(dyn Fn([i64; 3]) -> f64 + Sync),
    refine: &(dyn Fn([f64; 3], f64, [f64; 3], f64) -> [f64; 3] + Sync),
) -> (Vec<f32>, Vec<u32>) {
    // Corners and cells keyed by their packed coordinates (`grid_key::key`).
    let mut values: WordMap<u64, f32> = WordMap::default();
    let mut done: WordSet<u64> = WordSet::default();
    let mut front: Vec<[i64; 3]> = Vec::new();
    for seed in seeds {
        let cell: [i64; 3] =
            std::array::from_fn(|k| ((seed[k] - grid.origin[k]) / grid.cell).floor() as i64);
        if grid.holds(cell) && done.insert(key(cell)) {
            front.push(cell);
        }
    }
    let inside = |v: f32| f64::from(v) >= WINDING_THRESHOLD;
    // Each crossed cell by its key and its corners' mask.
    let mut crossed: Vec<(u64, u8)> = Vec::new();
    while !front.is_empty() {
        let mut needed: Vec<u64> = (front.par_iter())
            .flat_map_iter(|&c| (0..8).map(move |k| key(Grid::corner_at(c, k))))
            .filter(|c| !values.contains_key(c))
            .collect();
        needed.par_sort_unstable();
        needed.dedup();
        let computed: Vec<f32> = needed.par_iter().map(|&c| field(unkey(c)) as f32).collect();
        values.extend(needed.into_iter().zip(computed));
        let masks: Vec<u8> = (front.par_iter())
            .map(|&cell| {
                (0..8).fold(0u8, |mask, k| {
                    let value = values[&key(Grid::corner_at(cell, k))];
                    mask | u8::from(inside(value)) << k
                })
            })
            .collect();
        let crossing = |mask: u8| mask != 0 && mask != 255;
        // The crossed cells' neighbours not met before, in the order the cells and their faces
        // name them, each at its first naming.
        let met = &done;
        let named: Vec<u64> = (front.par_iter().zip(masks.par_iter()))
            .filter(|&(_, &mask)| crossing(mask))
            .flat_map_iter(move |(&cell, _)| {
                (0..3)
                    .flat_map(move |axis| {
                        [-1i64, 1].map(move |step| {
                            let mut n = cell;
                            n[axis] += step;
                            n
                        })
                    })
                    .filter(move |&n| grid.holds(n))
                    .map(key)
                    .filter(move |n| !met.contains(n))
            })
            .collect();
        crossed.par_extend(
            (front.par_iter().zip(masks.par_iter()))
                .filter(|&(_, &mask)| crossing(mask))
                .map(|(&cell, &mask)| (key(cell), mask)),
        );
        let (next, _) = first_seen(named);
        done.extend(next.iter().copied());
        front = next.into_par_iter().map(|cell| unkey(cell)).collect();
    }
    drop(done);
    // One vertex per crossed grid edge, shared by the cells around it: an edge keyed by its lower
    // corner and its axis, numbered in the order the crossed cells' triangles first name it.
    let named: Vec<u64> = (crossed.par_iter())
        .flat_map_iter(|&(cell, mask)| {
            let cell: [i64; 3] = unkey(cell);
            triangles(usize::from(mask))
                .iter()
                .flatten()
                .map(move |&e| {
                    let (a, b) = EDGES[e as usize];
                    grid_key::edge_key(Grid::corner_at(cell, a), Grid::corner_at(cell, b))
                })
        })
        .collect();
    drop(crossed);
    let (edges, indices) = first_seen(named);
    // Each edge with its ends' values, kept so the corners' values go before the crossings are
    // refined.
    let ends: Vec<(f32, f32)> = (edges.par_iter())
        .map(|&edge| {
            let (low, high) = edge_ends(edge);
            (values[&key(low)], values[&key(high)])
        })
        .collect();
    drop(values);
    let positions: Vec<f32> = (edges.par_iter().zip(ends.par_iter()))
        .flat_map_iter(|(&edge, &(fa, fb))| {
            let (a, b) = edge_ends(edge);
            let (pa, pb) = (grid.corner(a), grid.corner(b));
            refine(pa, f64::from(fa), pb, f64::from(fb)).map(|x| x as f32)
        })
        .collect();
    (positions, indices)
}

/// The crossing of `WINDING_THRESHOLD` between `p1` (value `v1`) and `p2` (value `v2`), found by
/// bisection — the winding number jumps rather than varies linearly, so interpolating the two
/// values would misplace it: the middle when both values match, an end nudged towards the other
/// when its value is the threshold, else `SEARCH_STEPS` bisections of `implicit` from the lower
/// value and the last bracket's middle.
fn bisect(
    implicit: &dyn Fn([f64; 3]) -> f64,
    (p1, v1): ([f64; 3], f64),
    (p2, v2): ([f64; 3], f64),
) -> [f64; 3] {
    const DT: f64 = 0.999999;
    if (v1 - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| (p1[k] + p2[k]) * 0.5);
    }
    if (WINDING_THRESHOLD - v1).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p1[k] + (1.0 - DT) * p2[k]);
    }
    if (WINDING_THRESHOLD - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p2[k] + (1.0 - DT) * p1[k]);
    }
    let (mut a, mut b) = if v2 < v1 { (p2, p1) } else { (p1, p2) };
    for _ in 0..SEARCH_STEPS {
        let m: [f64; 3] = std::array::from_fn(|k| (a[k] + b[k]) * 0.5);
        if implicit(m) < WINDING_THRESHOLD {
            a = m;
        } else {
            b = m;
        }
    }
    std::array::from_fn(|k| (a[k] + b[k]) * 0.5)
}

/// The voxel count across `bounds` for `accuracy`: the diagonal over the accuracy, within
/// `VOXEL_DIMENSION` — an endless diagonal (empty bounds) held at its top, never past `usize`.
pub(super) fn voxel_target((low, high): ([f64; 3], [f64; 3]), accuracy: f64) -> usize {
    let across = length(sub(high, low)) / accuracy;
    let cells = if across > VOXEL_DIMENSION.1 as f64 {
        VOXEL_DIMENSION.1
    } else {
        across as usize
    };
    (cells + 1).clamp(VOXEL_DIMENSION.0, VOXEL_DIMENSION.1)
}

/// The accuracy of a voxel `voxel` for sources within `bounds`: never finer than the solid's cell
/// on the grid it targets (`voxel_target`, capped by `VOXEL_DIMENSION`), the grid the solid is
/// sampled on.
pub(crate) fn accuracy(bounds: ([f64; 3], [f64; 3]), voxel: f64) -> f64 {
    voxel.max(solid_cell(bounds, voxel, voxel_target(bounds, voxel)))
}

/// The solid's cell for `bounds` over `target` cells: the largest side, extended by twice the
/// accuracy on each end, so the surface never touches the grid's border.
fn solid_cell((low, high): ([f64; 3], [f64; 3]), accuracy: f64, target: usize) -> f64 {
    (longest_side(low, high) + 4.0 * accuracy) / target as f64
}

/// The bytes a cell of the surface holds at the widest of the steps, which follow one another and
/// let go of what they read (`approximate`): the simplifier's, its mesh at the closing's full
/// resolution, about one vertex, two triangles and three edges a cell (`simplify.rs`):
/// - per vertex: its position (24), its edges held in place (40), its quadric (112), two flags (2);
/// - per triangle, twice: its corners (12), its quadric (112), its area (8), a flag (1);
/// - per edge, three times: its ends and triangles (16), its collapse point (24), its mark (4),
///   its heap entry and slot (12), a flag (1);
///
/// 178 + 266 + 171 = 615 bytes, rounded up. The marching (`march`: a corner's value, a crossed
/// cell, an edge and its ends' values, its vertex, two triangles — about 150 bytes) and each pass
/// of the closing (`morphology.rs`: a block of 512 nodes over some 64 surface cells, both its
/// meshes — about 200 bytes) hold less. Checked against `hlodEstimateOverPeak`.
const SURFACE_CELL_BYTES: usize = 640;

/// The bytes the surface `approximate` makes holds, estimated before it runs, for a solid whose
/// skin shows the grid's axes `skin` square metres (`world.rs`) within `bounds`, at `accuracy`:
/// every grid is sparse, kept near the surface, so the cells it holds are those its surface
/// crosses on the solid's grid — a face crosses as many cells of a unit grid as the area it shows
/// the three axes, `|nx| + |ny| + |nz|` times its own —, at the voxel count `voxel_target` gives.
pub(crate) fn surface_bytes(skin: f64, bounds: ([f64; 3], [f64; 3]), accuracy: f64) -> usize {
    let (low, high) = bounds;
    if !(0..3).all(|k| low[k] <= high[k]) {
        return 0;
    }
    let cell = solid_cell(bounds, accuracy, voxel_target(bounds, accuracy));
    let cells = (skin / (cell * cell)).max(1.0);
    (cells as usize).saturating_mul(SURFACE_CELL_BYTES)
}

/// The solid of `scene` — where its winding number passes `WINDING_THRESHOLD` or a shell holds the
/// point — meshed by marching cubes over `target` cells.
pub(super) fn solidify(scene: &Scene, accuracy: f64, target: usize) -> (Vec<f32>, Vec<u32>) {
    let (low, high) = scene.bounds;
    let extend = 2.0 * accuracy;
    let cell = solid_cell(scene.bounds, accuracy, target);
    let inner_low: [f64; 3] = std::array::from_fn(|k| low[k] - extend);
    let inner_high: [f64; 3] = std::array::from_fn(|k| high[k] + extend);
    // Solid at the boundaries: the grid a tenth of a cell past the bounds, outside there.
    let origin: [f64; 3] = std::array::from_fn(|k| inner_low[k] - 0.1 * cell);
    let cells: [i64; 3] =
        std::array::from_fn(|k| ((inner_high[k] + 0.1 * cell - origin[k]) / cell).ceil() as i64);
    let grid = Grid {
        origin,
        cell,
        cells,
    };
    let implicit = |p: [f64; 3]| -> f64 {
        if (0..3).all(|k| p[k] >= inner_low[k] && p[k] <= inner_high[k]) {
            // Inside a shell, the point is inside whatever the solids add: one, the field past
            // the threshold.
            if scene.shells.inside(p) {
                1.0
            } else {
                scene.winding.at(p)
            }
        } else {
            -(WINDING_THRESHOLD + 1.0)
        }
    };
    let field = |c: [i64; 3]| implicit(grid.corner(c));
    let refine = |a: [f64; 3], fa: f64, b: [f64; 3], fb: f64| bisect(&implicit, (a, fa), (b, fb));
    march(&grid, &scene.seeds, &field, &refine)
}
