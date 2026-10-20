//! The voxels a triangle overlaps, on the grid of side `side` from the object origin: the columns
//! along the axis its normal leans on most, each from its plane's span over the column, every voxel
//! kept by the separating-axis test (Akenine-Möller). A voxel the triangle only touches is kept, so
//! a surface lying on a voxel face leaves no hole; the rays then give it to one side (`sample.rs`).
use crate::proxy::tracer::{vertex, World};
use std::collections::HashMap;
use trillion3d_math::vec3::{cross, dominant_axis};
use trillion3d_math::vecn::{dot, scale, sub};

/// A voxel: its corner nearest the origin over the side.
pub(super) type Cell = [i32; 3];

/// Slack of the spans, in voxels, so a corner on a face reaches the voxels on both sides.
const SLACK: f64 = 1e-7;

/// Calls `visit` with each voxel of side `side` the triangle `corners` overlaps.
pub(super) fn cells(corners: [[f64; 3]; 3], side: f64, mut visit: impl FnMut(Cell)) {
    let t = corners.map(|c| scale(c, 1.0 / side));
    let low: Cell =
        std::array::from_fn(|k| (t[0][k].min(t[1][k]).min(t[2][k]) - SLACK).floor() as i32);
    let high: Cell =
        std::array::from_fn(|k| (t[0][k].max(t[1][k]).max(t[2][k]) + SLACK).floor() as i32);
    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    let d = dominant_axis(n);
    let (u, v) = ((d + 1) % 3, (d + 2) % 3);
    let offset = dot(n, t[0]);
    for cu in low[u]..=high[u] {
        for cv in low[v]..=high[v] {
            // The plane's span along `d` over the column's square, when the plane is not along it.
            let (from, to) = if n[d] != 0.0 {
                let at = |a: i32, b: i32| (offset - n[u] * a as f64 - n[v] * b as f64) / n[d];
                let span = [
                    at(cu, cv),
                    at(cu + 1, cv),
                    at(cu, cv + 1),
                    at(cu + 1, cv + 1),
                ];
                let lo = span.iter().fold(f64::INFINITY, |m, &x| m.min(x)) - SLACK;
                let hi = span.iter().fold(f64::NEG_INFINITY, |m, &x| m.max(x)) + SLACK;
                (
                    low[d].max(lo.floor() as i32),
                    high[d].min(hi.floor() as i32),
                )
            } else {
                (low[d], high[d])
            };
            for cd in from..=to {
                let mut cell = [0; 3];
                (cell[u], cell[v], cell[d]) = (cu, cv, cd);
                if overlaps(t, cell) {
                    visit(cell);
                }
            }
        }
    }
}

/// Whether the triangle `t`, in voxels, overlaps voxel `cell`, touching counted: no axis among the
/// box's three, the triangle's normal and the nine crossings of an edge with a box axis separates
/// them.
fn overlaps(t: [[f64; 3]; 3], cell: Cell) -> bool {
    let centre = cell.map(|c| c as f64 + 0.5);
    let t = t.map(|c| sub(c, centre));
    let half = 0.5 + SLACK;
    let separates = |axis: [f64; 3]| {
        let p = t.map(|c| dot(c, axis));
        let reach = half * (axis[0].abs() + axis[1].abs() + axis[2].abs());
        p[0].min(p[1]).min(p[2]) > reach || p[0].max(p[1]).max(p[2]) < -reach
    };
    let units = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let edges = [sub(t[1], t[0]), sub(t[2], t[1]), sub(t[0], t[2])];
    let crossed = edges.iter().flat_map(|&e| units.map(|a| cross(e, a)));
    !(units.into_iter().any(separates)
        || separates(cross(edges[0], edges[1]))
        || crossed.into_iter().any(separates))
}

/// The triangles of `triangles` — ranks in `world` — overlapping each of `candidates`, cells of side
/// `side`, by their rank: what both an HLOD cell's tiles and a mesh's far groups sample each voxel
/// against.
pub(super) fn binned(
    world: &World,
    (candidates, side): (&[Cell], f64),
    triangles: impl Iterator<Item = usize>,
) -> Vec<Vec<u32>> {
    let at: HashMap<Cell, usize> = (candidates.iter().enumerate())
        .map(|(i, &c)| (c, i))
        .collect();
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); candidates.len()];
    for t in triangles {
        let c = [0, 1, 2].map(|k| vertex(world, t, k));
        cells(c, side, |cell| {
            if let Some(&i) = at.get(&cell) {
                bins[i].push(t as u32);
            }
        });
    }
    bins
}
