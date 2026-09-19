//! Proxy-specific simplification: bounded size triangles, under meter threshold.
//!
//! DAG cut stops at root level: when root weighs more than budget,
//! doubling threshold changes nothing and proxy retains millions of triangles. Proxy
//! simplifies itself by rule independent of DAG: vertices snapped to
//! grid step `c`, degenerate triangles from snapping disappear, duplicates
//! merge, and what remains larger than `c` is subdivided until longest side <= c.
//! passe sous `c`.
//!
//! Both directions count. Downwards, merge reduces triangle count. Upwards,
//! subdivision gives surface cache known-size meshes: light per
//! triangle makes sense only if triangle is small compared to room it illuminates.
//!
//! Added geometric error bounded by mesh cell half-diagonal, published with
//! proxy. Subdivision is planar: adds no error.
use super::PROXY_TRIANGLE_FLOATS;
use std::collections::HashSet;

/// Grid step doublings before giving up: known bound, like `cut.rs` scale.
const CELL_LADDER: usize = 24;
/// Unit cube half-diagonal: max vertex displacement joining grid cell corner.
pub const CELL_ERROR_FACTOR: f64 = 0.866_025_403_784_438_6;
/// One-sided subdivisions at most: known bound, preventing giant triangle
/// explosion during step search.
const MAX_DIVISIONS: usize = 4096;

/// Vertex grid cell: three integers, nearest grid corner step `size`.
fn cell_of(vertex: &[f32], size: f64) -> [i32; 3] {
    [
        (vertex[0] as f64 / size).round() as i32,
        (vertex[1] as f64 / size).round() as i32,
        (vertex[2] as f64 / size).round() as i32,
    ]
}

/// Longest side of a triangle, in meters.
fn longest_edge(t: &[f32]) -> f64 {
    let point = |i: usize| [t[i * 3] as f64, t[i * 3 + 1] as f64, t[i * 3 + 2] as f64];
    let span = |a: [f64; 3], b: [f64; 3]| {
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    let (a, b, c) = (point(0), point(1), point(2));
    span(a, b).max(span(b, c)).max(span(c, a))
}

/// Side subdivisions: `n` gives `n²` subtriangles, `n` bounded.
fn divisions(edge: f64, size: f64) -> usize {
    if !(edge.is_finite() && size > 0.0) {
        return 1;
    }
    ((edge / size).ceil() as usize).clamp(1, MAX_DIVISIONS)
}

/// Three grid cells of triangle, canonical order: duplicate key. Triangle
/// with two vertices in same cell has no area and disappears.
fn key_of(t: &[f32], size: f64) -> Option<[[i32; 3]; 3]> {
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

/// Triangles step `size` retains: those with non-zero area and not duplicated,
/// snapped to grid, with subdivision count required by longest side. Single
/// proxy read pass: counting and building follow identical rule.
fn kept(
    triangles: &[f32],
    size: f64,
) -> impl Iterator<Item = (usize, [f32; PROXY_TRIANGLE_FLOATS], usize)> + '_ {
    let mut seen: HashSet<[[i32; 3]; 3]> = HashSet::new();
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
            let snapped = snap(t, size);
            Some((index, snapped, divisions(longest_edge(&snapped), size)))
        })
}

/// How many triangles step `size` would leave without building. Stops on overflow.
fn count_at(triangles: &[f32], size: f64, budget: usize) -> usize {
    let mut total = 0usize;
    for (_, _, n) in kept(triangles, size) {
        total = total.saturating_add(n.saturating_mul(n));
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

/// Subtriangles of triangle subdivided into `n` per side, in barycentric coords.
fn subdivide(t: &[f32], n: usize, out: &mut Vec<f32>) {
    let at = |u: f64, v: f64| {
        let w = 1.0 - u - v;
        [0usize, 1, 2].map(|axis| {
            (t[axis] as f64 * w + t[3 + axis] as f64 * u + t[6 + axis] as f64 * v) as f32
        })
    };
    let step = 1.0 / n as f64;
    for row in 0..n {
        for column in 0..(n - row) {
            let (u, v) = (row as f64 * step, column as f64 * step);
            out.extend_from_slice(&at(u, v));
            out.extend_from_slice(&at(u + step, v));
            out.extend_from_slice(&at(u, v + step));
            if column + 1 < n - row {
                out.extend_from_slice(&at(u + step, v));
                out.extend_from_slice(&at(u + step, v + step));
                out.extend_from_slice(&at(u, v + step));
            }
        }
    }
}

/// Reduces proxy to bounded size triangles by `size`, albedo following triangle.
pub fn simplify(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>, size: f64) {
    let mut out: Vec<f32> = Vec::with_capacity(triangles.len());
    let mut colours: Vec<u32> = Vec::with_capacity(albedo.len());
    for (index, snapped, n) in kept(triangles, size) {
        let before = out.len();
        subdivide(&snapped, n, &mut out);
        let colour = albedo.get(index).copied().unwrap_or(0xffff_ffff);
        colours.resize(
            colours.len() + (out.len() - before) / PROXY_TRIANGLE_FLOATS,
            colour,
        );
    }
    *triangles = out;
    *albedo = colours;
}
