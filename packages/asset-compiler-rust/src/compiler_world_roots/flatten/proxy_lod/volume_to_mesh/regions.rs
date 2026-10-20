//! The regions merged, a polygon added, the disoriented triangles relaxed.
use super::super::grid::{add, leaf_offset, local_coord, normalize, Coord, Grid, Mask, DIM, SIZE};
use super::super::tables::{ADAPTABLE, EDGE_GROUP};
use super::cells::{gradient, non_manifold};
use super::{EDGES, SEAM, SIGNS, XEDGE, YEDGE, ZEDGE};
use rayon::prelude::*;
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{add as vadd, dot, sub};

/// The auxiliary trees on one leaf of the cells: sign flags (`Int16Tree`) and point indices
/// (`Index32Tree`), on the same topology.
pub(super) struct Aux {
    pub(super) origin: Coord,
    pub(super) flags: Box<[i16; SIZE]>,
    pub(super) on: Mask,
}

/// The regions merged in one leaf: the point index of every merged
/// block's voxels set to the block's region id.
pub(super) fn merge_regions(
    grid: &Grid,
    aux: &Aux,
    point_index: &mut [u32; SIZE],
    active: &dyn Fn(Coord) -> bool,
    iso: f32,
    adaptivity: f32,
) {
    let mut mask = Mask::default();
    let block = |c: Coord| leaf_offset([c[0] & !1, c[1] & !1, c[2] & !1]);
    let origin = aux.origin;
    for pos in aux.on.ons() {
        let flags = aux.flags[pos];
        let signs = (SIGNS & flags) as usize;
        let ijk = add(origin, local_coord(pos));
        if (flags & SEAM) != 0 || !ADAPTABLE[signs] || EDGE_GROUP[signs][0] > 1 {
            mask.set_on(block(ijk));
        } else if (flags & EDGES) != 0 {
            let mut region = !active(ijk);
            let checks: [(i16, [Coord; 3]); 3] = [
                (XEDGE, [[0, -1, 0], [0, -1, -1], [0, 0, -1]]),
                (YEDGE, [[0, 0, -1], [-1, 0, -1], [-1, 0, 0]]),
                (ZEDGE, [[0, -1, 0], [-1, -1, 0], [-1, 0, 0]]),
            ];
            for (edge, around) in checks {
                if !region && (flags & edge) != 0 {
                    region = around.iter().any(|&o| !active(add(ijk, o)));
                }
            }
            if region {
                mask.set_on(block(ijk));
            }
        }
    }
    let end = add(origin, [DIM; 3]);
    let blocks = |dim: i32| {
        let mut out = Vec::new();
        let mut x = origin[0];
        while x < end[0] {
            let mut y = origin[1];
            while y < end[1] {
                let mut z = origin[2];
                while z < end[2] {
                    out.push([x, y, z]);
                    z += dim;
                }
                y += dim;
            }
            x += dim;
        }
        out
    };
    for ijk in blocks(2) {
        if !mask.is_on(leaf_offset(ijk)) && non_manifold(grid, ijk, iso, 2) {
            mask.set_on(leaf_offset(ijk));
        }
    }
    let use_gradients = adaptivity < 1.0f32;
    let mut gradients: [Option<[f32; 3]>; SIZE] = [None; SIZE];
    if use_gradients {
        for pos in aux.on.ons() {
            let ijk = add(origin, local_coord(pos));
            if !mask.is_on(block(ijk)) {
                gradients[pos] = Some(gradient(grid, ijk));
            }
        }
    }
    // Whether a block may merge into one region.
    let mergeable = |start: Coord, dim: i32| {
        if adaptivity < 1e-6 {
            return false;
        }
        let mut norms = Vec::new();
        for x in start[0]..start[0] + dim {
            for y in start[1]..start[1] + dim {
                for z in start[2]..start[2] + dim {
                    if let Some(n) = gradients[leaf_offset([x, y, z])] {
                        norms.push(n);
                    }
                }
            }
        }
        norms.iter().all(|a| {
            norms
                .iter()
                .all(|b| !((1.0 - f64::from(dot(*a, *b))) > f64::from(adaptivity)))
        })
    };
    let mut region_id = 1u32;
    let mut dim = 2;
    while dim <= DIM {
        let coord_mask = !((dim << 1) - 1);
        for ijk in blocks(dim) {
            if mask.is_on(leaf_offset(ijk))
                || non_manifold(grid, ijk, iso, dim)
                || (use_gradients && !mergeable(ijk, dim))
            {
                mask.set_on(leaf_offset([
                    ijk[0] & coord_mask,
                    ijk[1] & coord_mask,
                    ijk[2] & coord_mask,
                ]));
            } else {
                for x in ijk[0]..ijk[0] + dim {
                    for y in ijk[1]..ijk[1] + dim {
                        for z in ijk[2]..ijk[2] + dim {
                            point_index[leaf_offset([x, y, z])] = region_id;
                        }
                    }
                }
                region_id += 1;
            }
        }
        dim <<= 1;
    }
}

/// One primitive of the adaptive builder: a quad, a triangle where two neighbouring
/// corners coincide, nothing otherwise.
pub(super) fn add_prim(
    quads: &mut Vec<[u32; 4]>,
    triangles: &mut Vec<[u32; 3]>,
    v: [u32; 4],
    reverse: bool,
) {
    let triangle = |triangles: &mut Vec<[u32; 3]>, v0: u32, v1: u32, v2: u32| {
        triangles.push(if reverse { [v2, v1, v0] } else { [v0, v1, v2] });
    };
    if v[0] != v[1] && v[0] != v[2] && v[0] != v[3] && v[1] != v[2] && v[1] != v[3] && v[2] != v[3]
    {
        quads.push(if reverse { [v[3], v[2], v[1], v[0]] } else { v });
    } else if v[0] == v[3] && v[1] != v[2] && v[1] != v[0] && v[2] != v[0] {
        triangle(triangles, v[0], v[1], v[2]);
    } else if v[1] == v[2] && v[0] != v[3] && v[0] != v[1] && v[3] != v[1] {
        triangle(triangles, v[0], v[1], v[3]);
    } else if v[0] == v[1] && v[2] != v[3] && v[2] != v[0] && v[3] != v[0] {
        triangle(triangles, v[0], v[2], v[3]);
    } else if v[2] == v[3] && v[0] != v[1] && v[0] != v[2] && v[1] != v[2] {
        triangle(triangles, v[0], v[1], v[2]);
    }
}

/// The points of triangles facing against the field's gradient marked, then moved to the mean of
/// their polygons.
pub(super) fn relax_disoriented(
    grid: &Grid,
    voxel: f64,
    pools: &[(Vec<[u32; 4]>, Vec<[u32; 3]>)],
    points: &mut [[f32; 3]],
) {
    let inv = 1.0 / voxel;
    let masked: Vec<Vec<u32>> = pools
        .par_iter()
        .map(|(_, triangles)| {
            let mut out = Vec::new();
            for t in triangles {
                let [v0, v1, v2] = t.map(|v| points[v as usize]);
                let normal = normalize(cross(sub(v2, v0), sub(v1, v0)), 1.0e-7);
                let third = 1.0f32 / 3.0f32;
                let centroid = vadd(vadd(v0, v1), v2).map(|v| v * third);
                let ijk = centroid.map(|v| (f64::from(v) * inv + 0.5).floor() as i32);
                let dir = gradient(grid, ijk);
                if dot(dir, normal) < -0.5f32 {
                    out.extend_from_slice(t);
                }
            }
            out
        })
        .collect();
    let mut mask = vec![false; points.len()];
    for v in masked.into_iter().flatten() {
        mask[v as usize] = true;
    }
    let mut updates = vec![0u8; points.len()];
    let mut sums = vec![[0.0f32; 3]; points.len()];
    for (quads, triangles) in pools {
        for q in quads {
            for &v in q {
                if mask[v as usize] {
                    let s = vadd(
                        vadd(
                            vadd(points[q[0] as usize], points[q[1] as usize]),
                            points[q[2] as usize],
                        ),
                        points[q[3] as usize],
                    );
                    sums[v as usize] = vadd(sums[v as usize], s);
                    updates[v as usize] = updates[v as usize].wrapping_add(4);
                }
            }
        }
        for t in triangles {
            for &v in t {
                if mask[v as usize] {
                    let s = vadd(
                        vadd(points[t[0] as usize], points[t[1] as usize]),
                        points[t[2] as usize],
                    );
                    sums[v as usize] = vadd(sums[v as usize], s);
                    updates[v as usize] = updates[v as usize].wrapping_add(3);
                }
            }
        }
    }
    for n in 0..points.len() {
        if updates[n] > 0 {
            let weight = (1.0 / f64::from(updates[n])) as f32;
            points[n] = sums[n].map(|v| v * weight);
        }
    }
}
