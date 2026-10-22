//! The charts of the mesh: the triangles joined, wherever two of them share an edge — their
//! corners at one place — whose coordinates and winding agree, into sets (`Join`), the sets
//! sorted and cut into charts each measured by its triangles, then the charts that meet along a
//! full side of their boxes joined (`join`).
//!
//! Two corners at one place (`Neighbours`) belong to adjacent triangles when the corners after
//! them, one turn on, are at one place too, in either direction (an edge). Their triangles are
//! joined when both ends of the edge hold the same coordinates and the triangles turn alike in
//! the coordinates. Otherwise, when the normals agree at both ends and the edge's coordinates
//! are the same translated, the edge is kept as a candidate for joining the two charts side by
//! side, one match for each edge.
//!
//! Two positions, two normals and two coordinates are the same when every axis lies within a
//! tolerance of zero, `|d| <= t`. The reference's sweep for corners at one place tests a position
//! as `!(|d| > t)`, which differs only where a coordinate is NaN; such a mesh has no finite area
//! and is refused by the packing (`packer::find_best`), so the one test serves both.
use super::chart::{near_zero, Chart};
use super::join::{self, Links};
use super::Corners;
use crate::hlod::flatten::sort::unstable_sort;
use crate::support::neighbours::Neighbours;
use trillion3d_math::geometry::aabb::extend_aabb_f32;
use trillion3d_math::join::{GreatestRoot, Join};
use trillion3d_math::vector::vecn::{length, sub};

/// Two positions, two normals or two coordinates are the same within this.
pub(super) const SAME: f32 = 0.00002;

/// What the search leaves: the charts, the corners' coordinates (moved where charts were joined)
/// and the triangles sorted by chart, each chart holding a run of them.
pub(super) struct Found {
    pub(super) charts: Vec<Chart>,
    pub(super) uvs: Vec<[f32; 2]>,
    pub(super) sorted: Vec<u32>,
}

/// Whether the positions of corners `a` and `b` are the same.
fn positions_match(c: &Corners, a: usize, b: usize) -> bool {
    near_zero(sub(c.positions[a], c.positions[b]), SAME)
}

/// Whether the normals of corners `a` and `b` are the same.
fn normals_match(c: &Corners, a: usize, b: usize) -> bool {
    near_zero(sub(c.normals[a], c.normals[b]), SAME)
}

/// Whether the coordinates of corners `a` and `b` are the same.
fn uvs_match(c: &Corners, a: usize, b: usize) -> bool {
    near_zero(sub(c.uvs[a], c.uvs[b]), SAME)
}

/// The signed area of triangle `tri`'s coordinates.
fn triangle_uv_area(c: &Corners, tri: usize) -> f32 {
    let edge1 = sub(c.uvs[3 * tri + 1], c.uvs[3 * tri]);
    let edge2 = sub(c.uvs[3 * tri + 2], c.uvs[3 * tri]);
    0.5f32 * (edge1[0] * edge2[1] - edge1[1] * edge2[0])
}

/// The corners at one place: ranked by a weighed sum of their position, swept within the
/// tolerance of the rank.
fn corners_at_one_place(c: &Corners) -> Neighbours {
    let weighed = |p: [f32; 3]| 0.30f32 * p[0] + 0.33f32 * p[1] + 0.37f32 * p[2];
    let mut ranked: Vec<(f32, u32)> = (c.positions.iter().enumerate())
        .map(|(corner, &p)| (weighed(p), corner as u32))
        .collect();
    unstable_sort(&mut ranked, |a, b| a.0 < b.0);
    let near = |a: u32, b: u32| positions_match(c, a as usize, b as usize);
    Neighbours::sweep(c.positions.len(), &ranked, SAME, near)
}

/// The triangles that share an edge and agree joined into sets (`set`), and per corner the corner
/// it is matched to across an edge by a translation of the coordinates, `-1` for none.
fn unions(c: &Corners, areas: &[f32], set: &mut Join<GreatestRoot>) -> Vec<i32> {
    let overlaps = corners_at_one_place(c);
    let mut matched = vec![-1i32; c.positions.len()];
    for i in 0..c.positions.len() {
        for &j in overlaps.of(i) {
            let j = j as usize;
            if j <= i || !positions_match(c, i, j) {
                continue;
            }
            let (tri_i, tri_j) = (i / 3, j / 3);
            let (i1, i2) = (3 * tri_i + (i + 1) % 3, 3 * tri_i + (i + 2) % 3);
            let (j1, j2) = (3 * tri_j + (j + 1) % 3, 3 * tri_j + (j + 2) % 3);
            let edge21 = positions_match(c, i2, j1);
            let edge12 = positions_match(c, i1, j2);
            if !(edge21 || edge12) {
                continue;
            }
            let (ie, je) = if edge21 { (i2, j1) } else { (i1, j2) };
            let agree = uvs_match(c, i, j) && uvs_match(c, ie, je);
            if agree && areas[tri_i] * areas[tri_j] >= 0.0 {
                set.unite(tri_i as u32, tri_j as u32);
            } else if normals_match(c, i, j) && normals_match(c, ie, je) {
                let edge_i = sub(c.uvs[ie], c.uvs[i]);
                let edge_j = sub(c.uvs[je], c.uvs[j]);
                if near_zero(sub(edge_i, edge_j), SAME) {
                    let (a, b) = if edge21 { (i2, j) } else { (i, j2) };
                    if matched[a] < 0 && matched[b] < 0 {
                        matched[a] = b as i32;
                        matched[b] = a as i32;
                    }
                }
            }
        }
    }
    matched
}

/// Triangle `tri` taken into `chart`: its coordinates' bounds and area, and the lengths of its
/// edges in the mesh and in the coordinates.
fn grow(chart: &mut Chart, c: &Corners, tri: usize) {
    let corner = |k: usize| 3 * tri + k;
    let uv = [0, 1, 2].map(|k| c.uvs[corner(k)]);
    for p in uv {
        extend_aabb_f32(&mut chart.min, &mut chart.max, p);
    }
    let p = [0, 1, 2].map(|k| c.positions[corner(k)]);
    let (edge1, edge2, edge3) = (sub(p[1], p[0]), sub(p[2], p[0]), sub(p[2], p[1]));
    let (uv1, uv2, uv3) = (sub(uv[1], uv[0]), sub(uv[2], uv[0]), sub(uv[2], uv[1]));
    chart.uv_area += 0.5f32 * (uv1[0] * uv2[1] - uv1[1] * uv2[0]).abs();
    chart.world_length_sum += length(edge1) + length(edge2) + length(edge3);
    chart.uv_length_sum += length(uv1) + length(uv2) + length(uv3);
}

/// The charts of the mesh `c`: its triangles' sets sorted and cut into charts, then joined
/// (module doc).
pub(super) fn find(c: &Corners) -> Found {
    let triangles = c.positions.len() / 3;
    let areas: Vec<f32> = (0..triangles).map(|t| triangle_uv_area(c, t)).collect();
    let mut set = Join::<GreatestRoot>::new(triangles);
    let matched = unions(c, &areas, &mut set);
    let roots: Vec<u32> = (0..triangles as u32).map(|t| set.root(t)).collect();
    let mut by_root: Vec<(u32, u32)> = (roots.iter().copied()).zip(0..).collect();
    unstable_sort(&mut by_root, |a, b| a.0 < b.0);
    let sorted: Vec<u32> = by_root.iter().map(|&(_, t)| t).collect();
    let mut charts: Vec<Chart> = Vec::new();
    let mut chart_of = vec![0u32; triangles];
    let mut at = 0;
    while at < triangles {
        let root = by_root[at].0;
        chart_of[root as usize] = charts.len() as u32;
        let mut chart = Chart::new(charts.len(), at);
        while at < triangles && by_root[at].0 == root {
            grow(&mut chart, c, sorted[at] as usize);
            at += 1;
        }
        chart.last = at;
        charts.push(chart);
    }
    let mut found = Found {
        charts,
        uvs: c.uvs.to_vec(),
        sorted,
    };
    let links = Links {
        matched: &matched,
        chart_of: &chart_of,
        roots: &roots,
        areas: &areas,
    };
    join::link(&mut found, &links);
    join::merge(&mut found);
    found
}
