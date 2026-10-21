//! Hidden faces and hard normals.
use super::super::bake::tree::{points_of, soup, triangle_of, Tree};
use super::{ADDED_RAYS, TRIANGLE_SAMPLES};
use rayon::prelude::*;
use trillion3d_math::geometry::aabb::{aabb_of, centre, longest_side};
use trillion3d_math::geometry::triangle::{corner_angle, edge_key, triangle_cross};
use trillion3d_math::join::{Join, LeastRoot};
use trillion3d_math::vector::vec3::normalized_or;
use trillion3d_math::vector::vecn::{dot, length};
use trillion3d_page_codec::edges::first_uses;
mod stream;
use stream::Stream;

/// The seeds of the extra rays' stream and of the triangle samples' (`stream::Stream`).
const RAY_SEED: u32 = 2_123_123;
const SAMPLE_SEED: u32 = 124_233;
/// How far a tested point is pushed out along its normal before its rays leave it, metres: a
/// ten-billionth of a metre, past the rounding of the point it starts from.
const NUDGE: f64 = 1e-10;

/// The triangles of `positions` and `indices` but those no point of which sees out: a point is
/// hidden when every ray of the six axes and of `ADDED_RAYS` random directions meets the shell or,
/// `from_below`, the plane under it; a triangle is removed when its corners, centroid and
/// `TRIANGLE_SAMPLES` random points are all hidden. The selection is grown by one ring and shrunk
/// by two before the removal, so isolated hidden specks stay and the cut runs clear of the visible
/// border. Where some triangle is hidden and a ground plane discards at height `ground`, every
/// triangle whose three corners lie on or under it joins the selection after that.
pub(super) fn remove_occluded(
    positions: &[f32],
    indices: &[u32],
    (from_below, ground): (bool, Option<f64>),
) -> Vec<u32> {
    let tree = Tree::from_soup(soup(positions, indices));
    let points = points_of(positions);
    let (low, high) = aabb_of(points.iter().copied());
    // The occluder under the shell, the ground nobody looks up through: a square ten times its
    // largest side,
    // a centimetre under it, glTF's up `+Y`.
    let floor = low[1] - 0.01;
    let half = 5.0 * longest_side(low, high);
    let centre = centre(low, high);
    let under = |origin: [f64; 3], ray: [f64; 3]| {
        if !from_below || ray[1].abs() < 1e-12 {
            return false;
        }
        let t = (floor - origin[1]) / ray[1];
        t > 0.0 && {
            let p: [f64; 3] = std::array::from_fn(|k| origin[k] + ray[k] * t);
            (p[0] - centre[0]).abs() <= half && (p[2] - centre[2]).abs() <= half
        }
    };
    let mut rays: Vec<[f64; 3]> = vec![
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
    ];
    // Their own streams, the rays' and the samples': moving one leaves the other where it was.
    let mut stream = Stream::new(RAY_SEED);
    rays.extend((0..ADDED_RAYS).map(|_| stream.direction()));
    let mut stream = Stream::new(SAMPLE_SEED);
    let mut samples: Vec<[f64; 3]> = (0..TRIANGLE_SAMPLES)
        .map(|_| {
            let b: [f64; 3] = std::array::from_fn(|_| f64::from(stream.fraction()) * 0.999 + 0.001);
            let s = b[0] + b[1] + b[2];
            b.map(|x| x / s)
        })
        .collect();
    samples.push([1.0 / 3.0; 3]);
    let hidden = |p: [f64; 3], normal: [f64; 3]| {
        let origin: [f64; 3] = std::array::from_fn(|k| p[k] + normal[k] * NUDGE);
        rays.iter()
            .all(|&ray| under(origin, ray) || tree.blocked((origin, ray)))
    };
    let count = indices.len() / 3;
    let (crosses, face) = face_vectors(positions, indices);
    // Each vertex's normal: its triangles' unit normals weighted by their area and the vertex's
    // interior angle on each, summed.
    let vertex_normal = group_sums(
        positions,
        indices,
        (&crosses, &face),
        (points.len(), |corner: usize| indices[corner] as usize),
    );
    let vertex_hidden: Vec<bool> = (0..points.len())
        .into_par_iter()
        .map(|v| hidden(points[v], normalized_or(vertex_normal[v], [0.0, 1.0, 0.0])))
        .collect();
    let removed: Vec<bool> = (0..count)
        .into_par_iter()
        .map(|t| {
            let corners = [0, 1, 2].map(|k| indices[t * 3 + k] as usize);
            corners.iter().all(|&v| vertex_hidden[v]) && {
                let [a, b, c] = corners.map(|v| points[v]);
                samples.iter().all(|w| {
                    let p = std::array::from_fn(|k| a[k] * w[0] + b[k] * w[1] + c[k] * w[2]);
                    hidden(p, face[t])
                })
            }
        })
        .collect();
    // Grown by one ring of neighbours, then its border shrunk twice.
    let mut by_vertex: Vec<Vec<usize>> = vec![Vec::new(); points.len()];
    for t in 0..count {
        for k in 0..3 {
            by_vertex[indices[t * 3 + k] as usize].push(t);
        }
    }
    let mut selected = removed.clone();
    for t in (0..count).filter(|&t| removed[t]) {
        for n in ring(&by_vertex, indices, t) {
            selected[n] = true;
        }
    }
    for _ in 0..2 {
        let before = selected.clone();
        for t in (0..count).filter(|&t| before[t]) {
            if ring(&by_vertex, indices, t).any(|n| !before[n]) {
                selected[t] = false;
            }
        }
    }
    // The ground's own triangles, only where the filter hid some: those wholly on or under it.
    if let Some(height) = ground.filter(|_| removed.iter().any(|&r| r)) {
        for t in 0..count {
            let corners = [0, 1, 2].map(|k| points[indices[t * 3 + k] as usize]);
            if corners.iter().all(|p| p[1] - height <= 0.0) {
                selected[t] = true;
            }
        }
    }
    (0..count)
        .filter(|&t| !selected[t])
        .flat_map(|t| [0, 1, 2].map(|k| indices[t * 3 + k]))
        .collect()
}

/// The triangles of the three vertices of triangle `t`, `by_vertex` listing each vertex's, each as
/// many times as it holds of them.
fn ring<'a>(
    by_vertex: &'a [Vec<usize>],
    indices: &'a [u32],
    t: usize,
) -> impl Iterator<Item = usize> + 'a {
    (0..3).flat_map(move |k| by_vertex[indices[t * 3 + k] as usize].iter().copied())
}

/// Hard normals: around each vertex, the triangles joined across edges whose faces turn by less
/// than `angle` degrees share one normal, their area- and angle-weighted mean; with no angle, every
/// triangle around a vertex shares it, one normal a vertex. One per corner.
pub(super) fn hard_normals(
    positions: &[f32],
    indices: &[u32],
    angle: Option<f64>,
) -> Vec<[f32; 3]> {
    let count = indices.len() / 3;
    let (faces, unit) = face_vectors(positions, indices);
    // Corner `t·3 + k` joins the corners of its vertex on triangles across smooth edges.
    let mut join = Join::<LeastRoot>::new(count * 3);
    let Some(angle) = angle else {
        // One normal a vertex: each corner joins the first corner naming its vertex.
        let first = first_uses(positions.len() / 3, indices);
        for (corner, &v) in indices.iter().enumerate() {
            join.unite(first[v as usize], corner as u32);
        }
        return weighted_normals(positions, indices, (&faces, &unit), &mut join);
    };
    let limit = angle.to_radians().cos();
    // Each edge's triangles in order, by sorting: the union-find unites under the least id, so
    // the groups do not depend on the order the edges are walked in.
    let mut by_edge: Vec<(u64, u32)> = (0..count)
        .into_par_iter()
        .flat_map_iter(|t| {
            [0, 1, 2].map(|k| {
                let (a, b) = (indices[t * 3 + k], indices[t * 3 + (k + 1) % 3]);
                (edge_key(a, b), t as u32)
            })
        })
        .collect();
    by_edge.par_sort_unstable();
    let corner_of = |t: usize, v: u32| (0..3).find(|&k| indices[t * 3 + k] == v).map(|k| t * 3 + k);
    for run in by_edge.chunk_by(|x, y| x.0 == y.0) {
        let key = run[0].0;
        let (a, b) = ((key >> 32) as u32, key as u32);
        for i in 0..run.len() {
            for j in i + 1..run.len() {
                let (s, t) = (run[i].1 as usize, run[j].1 as usize);
                if dot(unit[s], unit[t]) <= limit {
                    continue;
                }
                for v in [a, b] {
                    if let (Some(x), Some(y)) = (corner_of(s, v), corner_of(t, v)) {
                        join.unite(x as u32, y as u32);
                    }
                }
            }
        }
    }
    weighted_normals(positions, indices, (&faces, &unit), &mut join)
}

/// Each triangle's normal as `(c − a) × (b − a)` winds it, `faces`, and its unit normal, `+y` for a
/// triangle too small to give one.
fn face_vectors(positions: &[f32], indices: &[u32]) -> (Vec<[f64; 3]>, Vec<[f64; 3]>) {
    let faces: Vec<[f64; 3]> = (0..indices.len() / 3)
        .map(|t| {
            let [a, b, c] = triangle_of(positions, indices, t);
            triangle_cross(a, b, c)
        })
        .collect();
    let unit = (faces.iter())
        .map(|&n| normalized_or(n, [0.0, 1.0, 0.0]))
        .collect();
    (faces, unit)
}

/// Per group of corners of `indices`, `(groups, group)` naming each corner's group: each triangle's
/// unit normal (`unit`, its unnormalized `faces`) weighted by its area and the corner's interior
/// angle — a large face counts more, and a vertex's normal does not depend on how its fan is split
/// —, summed over the group's corners.
fn group_sums(
    positions: &[f32],
    indices: &[u32],
    (faces, unit): (&[[f64; 3]], &[[f64; 3]]),
    (groups, mut group): (usize, impl FnMut(usize) -> usize),
) -> Vec<[f64; 3]> {
    let mut sums = vec![[0.0f64; 3]; groups];
    for corner in 0..indices.len() {
        let t = corner / 3;
        let area = 0.5 * length(faces[t]);
        let angle = corner_angle(triangle_of(positions, indices, t), corner % 3);
        let sum = &mut sums[group(corner)];
        for a in 0..3 {
            sum[a] += unit[t][a] * area * angle;
        }
    }
    sums
}

/// Per corner of `indices`, the normal of its group in `join`: the sum of the weighted unit normals
/// of the group's corners (`group_sums`), made unit.
fn weighted_normals(
    positions: &[f32],
    indices: &[u32],
    (faces, unit): (&[[f64; 3]], &[[f64; 3]]),
    join: &mut Join<LeastRoot>,
) -> Vec<[f32; 3]> {
    let count = indices.len() / 3;
    let sums = group_sums(
        positions,
        indices,
        (faces, unit),
        (count * 3, |corner: usize| join.root(corner as u32) as usize),
    );
    (0..count * 3)
        .map(|corner| {
            let root = join.root(corner as u32) as usize;
            normalized_or(sums[root], unit[corner / 3]).map(|x| x as f32)
        })
        .collect()
}
