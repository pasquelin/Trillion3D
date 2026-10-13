//! Proxy-specific simplification: bounded size triangles, on a grid.
//!
//! A mesh's own cut stops at its DAG roots: when the roots weigh more than the proxy allows,
//! doubling the threshold changes nothing and the proxy would retain millions of triangles. The proxy
//! simplifies itself by a rule independent of the DAG: vertices are snapped to a grid of step `c`,
//! the triangles that snapping flattens disappear and duplicates merge. Nothing is subdivided: a
//! triangle wider than `c` stays one triangle, the subdivision of a plane being planar and adding no
//! precision, only bytes — a ray lights its hit where it lands.
//!
//! The geometric error this adds is bounded by the half-diagonal of a grid cell, published with the
//! proxy.
use super::PROXY_TRIANGLE_FLOATS;
use crate::hash::WordSet;

/// Grid step doublings before giving up: known bound, like `cut.rs` scale.
const CELL_LADDER: usize = 24;
/// Unit cube half-diagonal: max vertex displacement joining grid cell corner.
pub const CELL_ERROR_FACTOR: f64 = 0.866_025_403_784_438_6;

/// Vertex grid cell: three integers, nearest grid corner step `size`.
fn cell_of(vertex: &[f32], size: f64) -> [i32; 3] {
    [
        (vertex[0] as f64 / size).round() as i32,
        (vertex[1] as f64 / size).round() as i32,
        (vertex[2] as f64 / size).round() as i32,
    ]
}

/// Three grid cells of triangle, canonical order: duplicate key. Triangle
/// with two vertices in same cell has no area and disappears.
pub fn key_of(t: &[f32], size: f64) -> Option<[[i32; 3]; 3]> {
    let cells = [
        cell_of(&t[0..3], size),
        cell_of(&t[3..6], size),
        cell_of(&t[6..9], size),
    ];
    if cells[0] == cells[1] || cells[1] == cells[2] || cells[2] == cells[0] {
        return None;
    }
    let mut sorted = cells;
    sorted.sort_unstable();
    Some(sorted)
}

/// Triangle snapped to grid, vertex by vertex.
fn snap(t: &[f32], size: f64) -> [f32; PROXY_TRIANGLE_FLOATS] {
    let mut out = [0f32; PROXY_TRIANGLE_FLOATS];
    for vertex in 0..3 {
        let cell = cell_of(&t[vertex * 3..vertex * 3 + 3], size);
        for axis in 0..3 {
            out[vertex * 3 + axis] = (cell[axis] as f64 * size) as f32;
        }
    }
    out
}

/// Triangles step `size` retains: those with non-zero area and not duplicated, snapped to the
/// grid, with the rank of the source triangle that supplied each. Single proxy read pass: counting
/// and building follow the identical rule.
fn kept(
    triangles: &[f32],
    size: f64,
) -> impl Iterator<Item = (usize, [f32; PROXY_TRIANGLE_FLOATS])> + '_ {
    let mut seen = WordSet::<[[i32; 3]; 3]>::default();
    triangles
        .as_chunks::<PROXY_TRIANGLE_FLOATS>()
        .0
        .iter()
        .enumerate()
        .filter_map(move |(index, t)| {
            let key = key_of(t, size)?;
            if !seen.insert(key) {
                return None;
            }
            Some((index, snap(t, size)))
        })
}

/// How many triangles step `size` would leave without building. Stops on overflow.
fn count_at(triangles: &[f32], size: f64, budget: usize) -> usize {
    let mut total = 0usize;
    for _ in kept(triangles, size) {
        total += 1;
        if total > budget {
            return total;
        }
    }
    total
}

/// Finest grid step fitting triangle budget, starting from published floor.
///
/// Generic size rule, no scene name: small part keeps floor, city takes
/// multiple, taken step published with proxy.
pub fn plan_cell(triangles: &[f32], floor: f64, budget: usize) -> f64 {
    let mut size = floor.max(1e-4);
    for _ in 0..CELL_LADDER {
        if count_at(triangles, size, budget) <= budget {
            break;
        }
        size *= 2.0;
    }
    size
}

/// Snaps `triangles` to the grid `size` in place, dropping what has no area and what repeats: the
/// first of equal triangles stays, and `albedo` follows it. Returns the rank each kept triangle had
/// among the source triangles.
pub fn simplify_sources(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>, size: f64) -> Vec<usize> {
    let mut out: Vec<f32> = Vec::with_capacity(triangles.len());
    let mut colours: Vec<u32> = Vec::with_capacity(albedo.len());
    let mut sources: Vec<usize> = Vec::new();
    for (index, snapped) in kept(triangles, size) {
        out.extend_from_slice(&snapped);
        colours.push(albedo.get(index).copied().unwrap_or(0xffff_ffff));
        sources.push(index);
    }
    *triangles = out;
    *albedo = colours;
    sources
}
