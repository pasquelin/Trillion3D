//! The surface generated from the field.
use super::super::grid_key::{edge_key, key, unkey, LEAF_SIDE as BLOCK};
use super::super::marching::{corner_offset, triangles, EDGES, EDGE_TABLE};
use super::field::Field;
use super::patch::{find_iso, interpolate};
use super::{max_dim, Bounds, Mesh, SAFETY_MAX_DIMENSION};
use crate::hlod::flatten::first_seen::first_seen;
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordSet;

/// Marching cubes of `-field` at `iso` over `bounds` in cubes of side `cube`, enlarged past
/// `SAFETY_MAX_DIMENSION` cubes across: the surface, inside where the value is at or above `iso`,
/// and the cube side kept.
pub(super) fn generate(field: &Field, iso: f64, bounds: Bounds, cube: f64) -> (Mesh, f64) {
    let dims_of = |cube: f64| -> [i32; 3] {
        std::array::from_fn(|k| ((bounds.1[k] - bounds.0[k]) / cube) as i32 + 1)
    };
    let mut cube = cube;
    let mut dims = dims_of(cube);
    if dims.into_iter().max().unwrap_or(0) > SAFETY_MAX_DIMENSION {
        cube = max_dim(bounds) / f64::from(SAFETY_MAX_DIMENSION - 1);
        dims = dims_of(cube);
    }
    let corner_pos =
        |c: [i32; 3]| -> [f64; 3] { std::array::from_fn(|k| bounds.0[k] + cube * f64::from(c[k])) };
    // The cubes whose corners read a node within two of a touched block.
    let mut wanted: Vec<u64> = Vec::new();
    for block in field.touched_blocks() {
        let b = unkey::<i32>(block);
        let range = |k: usize| {
            let node = |n: i32| f64::from(field.origin[k]) + f64::from(n) * f64::from(field.cell);
            let low = node(b[k] * BLOCK - 2);
            let high = node(b[k] * BLOCK + BLOCK + 1);
            let first = (((low - bounds.0[k]) / cube).floor() as i32 - 2).max(0);
            let last = (((high - bounds.0[k]) / cube).ceil() as i32 + 1).min(dims[k] - 1);
            if first > last {
                return 1..=0;
            }
            (first / BLOCK)..=(last / BLOCK)
        };
        let (rx, ry, rz) = (range(0), range(1), range(2));
        for z in rz {
            for y in ry.clone() {
                for x in rx.clone() {
                    wanted.push(key([x, y, z]));
                }
            }
        }
    }
    wanted.par_sort_unstable();
    wanted.dedup();
    let parts: Vec<(Vec<(u64, [f64; 3])>, Vec<[u64; 3]>)> = wanted
        .par_iter()
        .map(|&block| {
            let low = unkey::<i32>(block).map(|b| b * BLOCK);
            let high: [i32; 3] = std::array::from_fn(|k| (low[k] + BLOCK).min(dims[k]));
            // Corners `low..=high`, and the field's nodes they read.
            let size: [usize; 3] = std::array::from_fn(|k| (high[k] - low[k] + 1) as usize);
            let node = |c: [i32; 3]| field.grid_point(corner_pos(c)).map(|x| x as i32);
            let (first, last) = (node(low), node(high));
            let patch = field.patch(first, last.map(|x| x + 1));
            let mut values = Vec::with_capacity(size[0] * size[1] * size[2]);
            for z in low[2]..=high[2] {
                for y in low[1]..=high[1] {
                    for x in low[0]..=high[0] {
                        values.push(-interpolate(field, &patch, corner_pos([x, y, z])));
                    }
                }
            }
            let value = |c: [i32; 3]| {
                let [i, j, k]: [usize; 3] = std::array::from_fn(|a| (c[a] - low[a]) as usize);
                values[i + size[0] * (j + size[1] * k)]
            };
            let (mut vertices, mut tris) = (Vec::new(), Vec::new());
            let mut seen: WordSet<u64> = WordSet::default();
            for z in low[2]..high[2] {
                for y in low[1]..high[1] {
                    for x in low[0]..high[0] {
                        let corner = |k: usize| {
                            let o = corner_offset(k);
                            [x + o[0] as i32, y + o[1] as i32, z + o[2] as i32]
                        };
                        let f: [f64; 8] = std::array::from_fn(|k| value(corner(k)));
                        let below = (0..8).fold(0usize, |m, k| m | usize::from(f[k] < iso) << k);
                        let crossed = EDGE_TABLE[below];
                        if crossed == 0 {
                            continue;
                        }
                        let mut edge_vertex = [0u64; 12];
                        for (e, &(a, b)) in EDGES.iter().enumerate() {
                            if crossed >> e & 1 == 1 {
                                let (ca, cb) = (corner(a), corner(b));
                                let id = edge_key(ca, cb);
                                if seen.insert(id) {
                                    let (pa, pb) = (corner_pos(ca), corner_pos(cb));
                                    vertices.push((id, find_iso(pa, pb, f[a], f[b], iso)));
                                }
                                edge_vertex[e] = id;
                            }
                        }
                        for t in triangles(!below & 0xff) {
                            let [a, b, c] = t.map(|e| edge_vertex[e as usize]);
                            if a != b && a != c && b != c {
                                tris.push([a, b, c]);
                            }
                        }
                    }
                }
            }
            (vertices, tris)
        })
        .collect();
    // Each vertex numbered at its first naming, block after block, and the triangles' corners by
    // the same ranks, sorted side by side; every part let go once read.
    let (vertex_parts, triangle_parts): (Vec<_>, Vec<_>) = parts.into_iter().unzip();
    let named_vertices: usize = vertex_parts.iter().map(Vec::len).sum();
    let named: Vec<u64> = (vertex_parts.iter().flatten().map(|&(id, _)| id))
        .chain(triangle_parts.into_iter().flatten().flatten())
        .collect();
    let (_, ranks) = first_seen(named);
    let mut mesh = Mesh {
        vertices: Vec::new(),
        triangles: ranks[named_vertices..].as_chunks::<3>().0.to_vec(),
    };
    for ((_, p), &rank) in vertex_parts.into_iter().flatten().zip(&ranks) {
        if rank as usize == mesh.vertices.len() {
            mesh.vertices.push(p);
        }
    }
    (mesh, cube)
}
