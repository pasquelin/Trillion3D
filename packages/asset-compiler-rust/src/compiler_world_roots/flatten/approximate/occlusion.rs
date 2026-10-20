//! Hidden faces and hard normals.
use super::super::tree::{soup, triangle_of, Tree};
use super::{ADDED_RAYS, HARD_NORMAL_ANGLE, TRIANGLE_SAMPLES};
use crate::join::Join;
use rayon::prelude::*;
use trillion3d_math::aabb::{aabb_of, centre, longest_side};
use trillion3d_math::random::splitmix_draw;
use trillion3d_math::triangle::{edge_key, face_normal};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};

/// The triangles of `positions` and `indices` but those no point of which sees out: a point is
/// hidden when every ray of the six axes and of `ADDED_RAYS` random directions meets the shell or
/// the plane under it; a triangle is removed when its corners, centroid and `TRIANGLE_SAMPLES`
/// random points are all hidden. The selection is grown by one ring and shrunk by two before the
/// removal, so isolated hidden specks stay and the cut runs clear of the visible border.
pub(super) fn remove_occluded(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    let tree = Tree::from_soup(soup(positions, indices));
    let points: Vec<[f64; 3]> = (positions.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let (low, high) = aabb_of(points.iter().copied());
    // The occluder under the shell, the ground nobody looks up through: a square ten times its
    // largest side,
    // a centimetre under it, glTF's up `+Y`.
    let floor = low[1] - 0.01;
    let half = 5.0 * longest_side(low, high);
    let centre = centre(low, high);
    let under = |origin: [f64; 3], ray: [f64; 3]| {
        if ray[1].abs() < 1e-12 {
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
    let mut state = 2123123u64;
    while rays.len() < 6 + ADDED_RAYS {
        let v: [f64; 3] = std::array::from_fn(|_| splitmix_draw(&mut state) * 2.0 - 1.0);
        let l = length(v);
        if l > 1e-3 && l <= 1.0 {
            rays.push(v.map(|x| x / l));
        }
    }
    let mut state = 124233u64;
    let mut samples: Vec<[f64; 3]> = (0..TRIANGLE_SAMPLES)
        .map(|_| {
            let b: [f64; 3] = std::array::from_fn(|_| splitmix_draw(&mut state) * 0.999 + 0.001);
            let s = b[0] + b[1] + b[2];
            b.map(|x| x / s)
        })
        .collect();
    samples.push([1.0 / 3.0; 3]);
    let offset = 1e-8;
    let hidden = |p: [f64; 3], normal: [f64; 3]| {
        let origin: [f64; 3] = std::array::from_fn(|k| p[k] + normal[k] * offset);
        rays.iter()
            .all(|&ray| under(origin, ray) || tree.blocked((origin, ray)))
    };
    let count = indices.len() / 3;
    let face: Vec<[f64; 3]> = (0..count)
        .map(|t| {
            let [a, b, c] = triangle_of(positions, indices, t);
            face_normal(a, b, c)
        })
        .collect();
    let mut vertex_normal = vec![[0.0f64; 3]; points.len()];
    for t in 0..count {
        for k in 0..3 {
            let v = indices[t * 3 + k] as usize;
            for a in 0..3 {
                vertex_normal[v][a] += face[t][a];
            }
        }
    }
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
    let ring = |t: usize| -> Vec<usize> {
        (0..3)
            .flat_map(|k| by_vertex[indices[t * 3 + k] as usize].iter().copied())
            .collect()
    };
    let mut selected = removed.clone();
    for t in (0..count).filter(|&t| removed[t]) {
        for n in ring(t) {
            selected[n] = true;
        }
    }
    for _ in 0..2 {
        let before = selected.clone();
        for t in (0..count).filter(|&t| before[t]) {
            if ring(t).iter().any(|&n| !before[n]) {
                selected[t] = false;
            }
        }
    }
    (0..count)
        .filter(|&t| !selected[t])
        .flat_map(|t| [0, 1, 2].map(|k| indices[t * 3 + k]))
        .collect()
}

/// Hard normals: around each vertex, the triangles joined across edges whose
/// faces turn by less than `HARD_NORMAL_ANGLE` share one normal, their area-weighted mean; one per
/// corner.
pub(super) fn hard_normals(positions: &[f32], indices: &[u32]) -> Vec<[f32; 3]> {
    let count = indices.len() / 3;
    let faces: Vec<[f64; 3]> = (0..count)
        .map(|t| {
            let [a, b, c] = triangle_of(positions, indices, t);
            cross(sub(b, a), sub(c, a))
        })
        .collect();
    let unit: Vec<[f64; 3]> = faces
        .iter()
        .map(|&n| normalized_or(n, [0.0, 1.0, 0.0]))
        .collect();
    // Corner `t·3 + k` joins the corners of its vertex on triangles across smooth edges.
    let mut join = Join::new(count * 3);
    let limit = HARD_NORMAL_ANGLE.to_radians().cos();
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
    // Each triangle's unit normal weighted by its area and the corner's interior angle: a large
    // face counts more, and a vertex's normal does not depend on how its fan is split.
    let mut sums = vec![[0.0f64; 3]; count * 3];
    for corner in 0..count * 3 {
        let root = join.root(corner as u32) as usize;
        let t = corner / 3;
        let area = 0.5 * length(faces[t]);
        let corners = triangle_of(positions, indices, t);
        let k = corner % 3;
        let angle = {
            let (e1, e2) = (
                sub(corners[(k + 1) % 3], corners[k]),
                sub(corners[(k + 2) % 3], corners[k]),
            );
            let (l1, l2) = (length(e1), length(e2));
            if l1 > 0.0 && l2 > 0.0 {
                (dot(e1, e2) / (l1 * l2)).clamp(-1.0, 1.0).acos()
            } else {
                0.0
            }
        };
        let sum = &mut sums[root];
        for a in 0..3 {
            sum[a] += unit[t][a] * area * angle;
        }
    }
    (0..count * 3)
        .map(|corner| {
            let root = join.root(corner as u32) as usize;
            normalized_or(sums[root], unit[corner / 3]).map(|x| x as f32)
        })
        .collect()
}
