//! What a source mesh's parts are read by: its connected components across shared edges and
//! whether each is closed, a part's thickness as the thin test measures it under a scale, a
//! part's copy, and the seed points a mesh gives.
use crate::hlod::flatten::mesh::{Mesh, NONE};
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vecn::{dot, length};

/// A component: its triangles, in the order the flood met them, and whether it is closed.
pub(super) type Component = (Vec<usize>, bool);

/// The connected components of `triangles` as the mesh they are appended to in order holds them
/// (`mesh::Mesh`): a triangle the mesh refuses — naming a vertex twice, on a side two triangles
/// hold already, repeating a held one — in none; grown from the least held triangle no component
/// holds yet, each one's triangles in the order a depth-first flood meets them, the neighbours
/// across a triangle's three sides in turn (`Mesh::neighbour_triangles`). A component is closed
/// when every side of each of its triangles joins it to a neighbour. Each triangle is named by its
/// rank in `triangles`.
pub(super) fn components(triangles: &[[usize; 3]]) -> Vec<Component> {
    let vertices = triangles.iter().flatten().max().map_or(0, |&v| v + 1);
    let mut mesh = Mesh::with_vertices(vertices);
    // Per held triangle, its rank among `triangles`.
    let held: Vec<usize> = (triangles.iter().enumerate())
        .filter_map(|(t, &triangle)| mesh.append(triangle).ok().map(|_| t))
        .collect();
    let mut met = vec![false; held.len()];
    let mut out = Vec::new();
    let mut pending = Vec::new();
    for seed in 0..held.len() {
        if met[seed] {
            continue;
        }
        met[seed] = true;
        pending.push(seed);
        let (mut own, mut closed) = (Vec::new(), true);
        while let Some(t) = pending.pop() {
            own.push(held[t]);
            for n in mesh.neighbour_triangles(t) {
                closed &= n != NONE;
                if n != NONE && !met[n] {
                    met[n] = true;
                    pending.push(n);
                }
            }
        }
        out.push((own, closed));
    }
    out
}

/// The thickness of the triangles of `all` that `triangles` names, over `points` scaled axis by
/// axis by `scale`, as the thin test reads it, and whether that is thin within `tolerance`: their
/// box's least side when it is under
/// the tolerance, else their spread along the unit normal of their largest triangle — the first of
/// the largest —, thin at most the tolerance.
pub(super) fn thickness(
    points: &[[f64; 3]],
    triangles: &[usize],
    all: &[[usize; 3]],
    (scale, tolerance): ([f64; 3], f64),
) -> (f64, bool) {
    let at = |v: usize| -> [f64; 3] { std::array::from_fn(|k| points[v][k] * scale[k]) };
    let corners = || triangles.iter().flat_map(|&t| all[t]);
    let (low, high) = aabb_of(corners().map(at));
    let least = (0..3)
        .map(|k| high[k] - low[k])
        .fold(f64::INFINITY, f64::min);
    if least < tolerance {
        return (least, true);
    }
    let (mut largest, mut normal) = (0.0f64, [0.0f64, 1.0, 0.0]);
    for &t in triangles {
        let [a, b, c] = all[t].map(at);
        let n = triangle_cross(a, b, c);
        let area = length(n);
        if area > largest {
            largest = area;
            normal = n.map(|x| x / area);
        }
    }
    let (mut near, mut far) = (f64::INFINITY, f64::NEG_INFINITY);
    for p in corners().map(at) {
        let d = dot(p, normal);
        near = near.min(d);
        far = far.max(d);
    }
    (far - near, far - near <= tolerance)
}

/// The mesh of `triangles` of `all` over `points`, each point `placed`: its vertices numbered in
/// the order the triangles first name them, and its triangles over them.
pub(super) fn copied(
    points: &[[f64; 3]],
    (triangles, all): (&[usize], &[[usize; 3]]),
    placed: impl Fn([f64; 3]) -> [f64; 3],
) -> (Vec<[f64; 3]>, Vec<[usize; 3]>) {
    let mut rank = vec![usize::MAX; points.len()];
    let mut out = Vec::new();
    let copied = (triangles.iter())
        .map(|&t| {
            all[t].map(|v| {
                if rank[v] == usize::MAX {
                    rank[v] = out.len();
                    out.push(placed(points[v]));
                }
                rank[v]
            })
        })
        .collect();
    (out, copied)
}

/// The points the surface is followed from, of a mesh of `points`: ten times the logarithm of the
/// vertex count, at most 500, every `skip`th vertex as it lies — a thin part's too: its shell is
/// read about its vertices, never pushed out of them.
pub(super) fn seed_points(points: &[[f64; 3]]) -> Vec<[f64; 3]> {
    let n = points.len();
    if n == 0 {
        return Vec::new();
    }
    let log = ((n as f64).ln().ceil() as usize).max(1);
    let count = (10 * log).min(500);
    let skip = (n / count).max(2);
    (0..n).step_by(skip).map(|k| points[k]).collect()
}
