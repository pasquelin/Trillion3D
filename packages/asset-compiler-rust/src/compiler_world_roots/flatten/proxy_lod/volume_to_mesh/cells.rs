//! A cell's values and signs, its non-manifold test, gradient and point.
use super::super::super::marching::corner_offset;
use super::super::grid::{add, normalize, Coord, Grid};
use super::super::tables::{ADAPTABLE, AMBIGUOUS_FACE, EDGE_GROUP};

/// Corner `k` of a cell `dim` voxels wide, in the marching order (`corner_offset`).
fn corner(k: usize, dim: i32) -> Coord {
    corner_offset(k).map(|c| c as i32 * dim)
}

pub(super) fn cell_values(grid: &Grid, ijk: Coord) -> [f32; 8] {
    std::array::from_fn(|k| grid.value(add(ijk, corner(k, 1))))
}

/// A cell's corner signs: bit n set when corner n is inside.
pub(super) fn sign_flags(values: &[f32; 8], iso: f32) -> u8 {
    values
        .iter()
        .enumerate()
        .fold(0u8, |s, (n, &v)| if v < iso { s | (1 << n) } else { s })
}

/// A cell sharing an ambiguous face with a neighbour that sees
/// the face the other way takes the complementary signs.
pub(super) fn correct_signs(signs: u8, face: u8, grid: &Grid, ijk: Coord, iso: f32) -> u8 {
    let (offset, expected): (Coord, u8) = match face {
        1 => ([0, 0, -1], 3),
        2 => ([1, 0, 0], 4),
        3 => ([0, 0, 1], 1),
        4 => ([-1, 0, 0], 2),
        5 => ([0, -1, 0], 6),
        6 => ([0, 1, 0], 5),
        _ => return signs,
    };
    if AMBIGUOUS_FACE[sign_flags(&cell_values(grid, add(ijk, offset)), iso) as usize] == expected {
        !signs
    } else {
        signs
    }
}

/// Whether a block of side `dim` whose corner signs are not adaptable, or
/// whose edge midpoints, face centres or centre change the sign topology.
pub(super) fn non_manifold(grid: &Grid, ijk: Coord, iso: f32, dim: i32) -> bool {
    let h = dim >> 1;
    let inside = |c: Coord| grid.value(c) < iso;
    let p: [bool; 8] = std::array::from_fn(|k| inside(add(ijk, corner(k, dim))));
    let signs = p
        .iter()
        .enumerate()
        .fold(0usize, |s, (n, &b)| if b { s | (1 << n) } else { s });
    if !ADAPTABLE[signs] {
        return true;
    }
    let [i, j, k] = ijk;
    let (ip, ipp, jp, jpp, kp, kpp) = (i + h, i + dim, j + h, j + dim, k + h, k + dim);
    let edges: [(Coord, usize, usize); 12] = [
        ([ip, j, k], 0, 1),
        ([ipp, j, kp], 1, 2),
        ([ip, j, kpp], 2, 3),
        ([i, j, kp], 0, 3),
        ([ip, jpp, k], 4, 5),
        ([ipp, jpp, kp], 5, 6),
        ([ip, jpp, kpp], 6, 7),
        ([i, jpp, kp], 7, 4),
        ([i, jp, k], 0, 4),
        ([ipp, jp, k], 1, 5),
        ([ipp, jp, kpp], 2, 6),
        ([i, jp, kpp], 3, 7),
    ];
    for (c, a, b) in edges {
        let m = inside(c);
        if p[a] != m && p[b] != m {
            return true;
        }
    }
    let faces: [(Coord, [usize; 4]); 6] = [
        ([ip, jp, k], [0, 1, 4, 5]),
        ([ipp, jp, kp], [1, 2, 5, 6]),
        ([ip, jp, kpp], [2, 3, 6, 7]),
        ([i, jp, kp], [0, 3, 4, 7]),
        ([ip, j, kp], [0, 1, 2, 3]),
        ([ip, jpp, kp], [4, 5, 6, 7]),
    ];
    for (c, corners) in faces {
        let m = inside(c);
        if corners.iter().all(|&n| p[n] != m) {
            return true;
        }
    }
    let m = inside([ip, jp, kp]);
    p.iter().all(|&b| b != m)
}

/// The field's gradient at voxel `ijk` by second order central differences, normalized.
pub(super) fn gradient(grid: &Grid, ijk: Coord) -> [f32; 3] {
    let d =
        |o: Coord| (grid.value(add(ijk, o)) - grid.value(add(ijk, [-o[0], -o[1], -o[2]]))) * 0.5f32;
    normalize([d([1, 0, 0]), d([0, 1, 0]), d([0, 0, 1])], 1.0e-7)
}

/// Where along an edge from value `v0` to `v1` the field crosses `iso`, from 0 to 1.
fn zero_crossing(v0: f64, v1: f64, iso: f64) -> f64 {
    (iso - v0) / (v1 - v0)
}

/// The mean crossing of the cell's edges in this edge group.
pub(super) fn compute_point(values: &[f64; 8], signs: u8, group: u8, iso: f64) -> [f64; 3] {
    let table = &EDGE_GROUP[signs as usize];
    let mut avg = [0.0f64; 3];
    let mut samples = 0;
    // (edge column, corner a, corner b, the varying axis, the two fixed coordinates).
    let edges: [(usize, usize, usize, usize, [f64; 3]); 12] = [
        (1, 0, 1, 0, [0.0, 0.0, 0.0]),
        (2, 1, 2, 2, [1.0, 0.0, 0.0]),
        (3, 3, 2, 0, [0.0, 0.0, 1.0]),
        (4, 0, 3, 2, [0.0, 0.0, 0.0]),
        (5, 4, 5, 0, [0.0, 1.0, 0.0]),
        (6, 5, 6, 2, [1.0, 1.0, 0.0]),
        (7, 7, 6, 0, [0.0, 1.0, 1.0]),
        (8, 4, 7, 2, [0.0, 1.0, 0.0]),
        (9, 0, 4, 1, [0.0, 0.0, 0.0]),
        (10, 1, 5, 1, [1.0, 0.0, 0.0]),
        (11, 2, 6, 1, [1.0, 0.0, 1.0]),
        (12, 3, 7, 1, [0.0, 0.0, 1.0]),
    ];
    for (column, a, b, axis, fixed) in edges {
        if table[column] == group {
            for k in 0..3 {
                if k == axis {
                    avg[k] += zero_crossing(values[a], values[b], iso);
                } else if fixed[k] != 0.0 {
                    avg[k] += fixed[k];
                }
            }
            samples += 1;
        }
    }
    if samples > 1 {
        let w = 1.0 / f64::from(samples);
        avg = avg.map(|v| v * w);
    }
    avg
}
