//! The source as a level set (Museth 2013), two voxels of narrow band each side, its closest
//! polygon kept per voxel — a signed field, self intersecting voxels removed, renormalized, the
//! narrow band trimmed — and the closest polygon grid beside it:
//!
//! 1. every triangle voxelized (`voxelize`): a flood from its first corner's
//!    voxel through the voxels it crosses (squared index distance at most 0.75) and their 26
//!    neighbours, each keeping its smallest squared distance and, on a tie, the smallest polygon;
//! 2. the outside traced (`trace_exterior`): every voxel line of every
//!    leaf column swept from both ends until it meets a crossed voxel, then flooded leaf by leaf
//!    through the voxels that cross nothing; the crossed voxels that see an outside neighbour in
//!    front of its closest polygon turn outside (`intersecting_signs`);
//! 3. the crossed voxels without an outside neighbour pushed past the boundary and the inside
//!    voxels without a boundary neighbour removed;
//! 4. distances to world units, inside negative, the signs flooded into the tiles, the field
//!    renormalized by one Godunov step around a 0.8 voxel offset
//!    and the voxels beyond the two voxel band deactivated and pruned.
//!
//! The band is two voxels on both sides, exactly the minimum: a wider band would need an
//! expansion pass, never run here.
//! The closest point lives in `closest`, voxelisation in `voxelize`, the exterior in `exterior`, the
//! signs in `signs`.
use super::grid::{add, leaf_offset, leaf_origin, local_coord, Coord, Grid, Mask, SIZE};
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordMap;
mod closest;
use closest::closest_point_on_triangle;
mod voxelize;
use voxelize::voxelize;
mod exterior;
use exterior::trace_exterior;
mod signs;
use signs::{any_neighbour, intersecting_signs};

/// The source triangles in index space: world centimetres times the
/// inverse voxel size.
pub(super) struct IndexMesh<'a> {
    pub points: &'a [[f64; 3]],
    pub tris: &'a [[u32; 3]],
}

impl IndexMesh<'_> {
    fn corners(&self, n: usize) -> [[f64; 3]; 3] {
        self.tris[n].map(|v| self.points[v as usize])
    }

    /// The point of polygon `poly` nearest `center`, its corners read in the order the sign test
    /// reads them.
    fn closest_point(&self, center: [f64; 3], poly: i32) -> [f64; 3] {
        let [a, b, c] = self.corners(poly as usize);
        closest_point_on_triangle(a, c, b, center)
    }
}

/// The closest polygon grid, 32-bit indices, the field leaves behind, read to find each
/// shell vertex's closest source polygon (`super::closest_poly`).
pub(super) struct PolyGrid {
    leaves: WordMap<Coord, Box<([i32; SIZE], Mask)>>,
}

impl PolyGrid {
    /// The polygon of voxel `c`, `None` when the voxel is not active.
    pub(super) fn probe(&self, c: Coord) -> Option<i32> {
        let (idx, on) = &**self.leaves.get(&leaf_origin(c))?;
        on.is_on(leaf_offset(c)).then(|| idx[leaf_offset(c)])
    }
}

/// The signed distance field and the closest polygon grid, `None` when no
/// voxel survives.
pub(super) fn mesh_to_volume(mesh: &IndexMesh, voxel: f64) -> Option<(Grid, PolyGrid)> {
    let mut grid = Grid::new(voxelize(mesh), f32::MAX);
    trace_exterior(&mut grid.leaves);

    let flips: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| intersecting_signs(&grid, mesh, leaf))
        .collect();
    for (leaf, flips) in grid.leaves.iter_mut().zip(flips) {
        for pos in flips {
            leaf.dist[pos] = -leaf.dist[pos];
        }
    }
    // A crossed voxel without an outside neighbour is pushed over
    // the boundary distance.
    let pushed: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .filter(|&pos| {
                    let dist = leaf.dist[pos];
                    !(dist < 0.0 || dist > 0.75) && !any_neighbour(&grid, leaf, pos, |v| v < 0.0)
                })
                .collect()
        })
        .collect();
    for (leaf, pushed) in grid.leaves.iter_mut().zip(pushed) {
        for pos in pushed {
            leaf.dist[pos] = 0.75f32 + 1e-7f32;
        }
    }
    // An inside voxel without a boundary neighbour is removed.
    let removed: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .filter(|&pos| {
                    leaf.dist[pos] > 0.75 && !any_neighbour(&grid, leaf, pos, |v| !(v > 0.75))
                })
                .collect()
        })
        .collect();
    for (leaf, removed) in grid.leaves.iter_mut().zip(removed) {
        for pos in removed {
            leaf.on.set_off(pos);
        }
    }
    grid.prune_inactive();
    if grid.leaves.is_empty() {
        return None;
    }
    let poly = PolyGrid {
        leaves: grid
            .leaves
            .iter()
            .map(|l| (l.origin, Box::new((l.idx, l.on))))
            .collect(),
    };

    // World units, the outside positive.
    let voxel_size = voxel as f32;
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            let v = leaf.dist[pos];
            let w = if v < 0.0 { voxel_size } else { -voxel_size };
            leaf.dist[pos] = w * v.abs().sqrt();
        }
    }
    let exterior = 2.0f32 * voxel_size;
    let interior = 2.0f32 * voxel_size;
    grid.background = exterior;
    grid.signed_flood_fill(exterior, -interior);

    // Offset, renormalized by one Godunov step, then the smaller of the two kept.
    let offset = (0.8 * f64::from(voxel_size)) as f32;
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            leaf.dist[pos] += -offset;
        }
    }
    let dx = voxel_size;
    let inv_dx = 1.0f32 / dx;
    let renormalized: Vec<Vec<(u16, f32)>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .map(|pos| {
                    let phi0 = leaf.dist[pos];
                    let ijk = add(leaf.origin, local_coord(pos));
                    let at = |o: Coord| grid.value(add(ijk, o));
                    let up = [
                        at([1, 0, 0]) - phi0,
                        at([0, 1, 0]) - phi0,
                        at([0, 0, 1]) - phi0,
                    ];
                    let down = [
                        phi0 - at([-1, 0, 0]),
                        phi0 - at([0, -1, 0]),
                        phi0 - at([0, 0, -1]),
                    ];
                    let norm = godunov_norm_sqrd(phi0 > 0.0, down, up);
                    let diff = norm.sqrt() * inv_dx - 1.0f32;
                    let s = phi0 / (phi0 * phi0 + norm).sqrt();
                    (pos as u16, phi0 - dx * s * diff)
                })
                .collect()
        })
        .collect();
    let back = offset - 1e-7f32;
    for (leaf, values) in grid.leaves.iter_mut().zip(renormalized) {
        for (pos, v) in values {
            leaf.dist[pos as usize] = leaf.dist[pos as usize].min(v);
        }
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            leaf.dist[pos] += back;
        }
    }

    // The band trimmed to two voxels: the voxels beyond it deactivated and pruned.
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            let v = leaf.dist[pos];
            let inside = v < 0.0;
            if inside && !(v > -interior) {
                leaf.dist[pos] = -interior;
                leaf.on.set_off(pos);
            } else if !inside && !(v < exterior) {
                leaf.dist[pos] = exterior;
                leaf.on.set_off(pos);
            }
        }
    }
    grid.prune_level_set(exterior, -interior);
    Some((grid, poly))
}

/// The squared gradient norm by Godunov's upwind scheme, `m` and `p` the backward and forward
/// differences, `outside` the side the value lies on.
fn godunov_norm_sqrd(outside: bool, m: [f32; 3], p: [f32; 3]) -> f32 {
    let mut len = 0.0f32;
    for k in 0..3 {
        len += if outside {
            (m[k].max(0.0).powi(2)).max(p[k].min(0.0).powi(2))
        } else {
            (m[k].min(0.0).powi(2)).max(p[k].max(0.0).powi(2))
        };
    }
    len
}
