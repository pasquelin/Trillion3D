//! Seeds, thinning, the scene and the mesh parts.
use super::super::winding::{Shells, Winding};
use super::{Mesh, Scene, MIN_THICKNESS, TINY_PART};
use crate::join::Join;
use rayon::prelude::*;
use trillion3d_math::aabb::{aabb_of, extend_aabb, longest_side, merge_aabb};
use trillion3d_math::triangle::edge_key;
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{dot, length, sub};

/// The points the surface is followed from: ten times the logarithm of the vertex count, at most
/// 500, every `skip`th vertex, pushed out along a triangle's normal by `offset`.
fn seed_points(vertices: &[[f64; 3]], normals: &[[f64; 3]], offset: f64, out: &mut Vec<[f64; 3]>) {
    let n = vertices.len();
    if n == 0 {
        return;
    }
    let log = ((n as f64).ln().ceil() as usize).max(1);
    let count = (10 * log).min(500);
    let skip = (n / count).max(2);
    for k in (0..n).step_by(skip) {
        out.push(std::array::from_fn(|a| {
            vertices[k][a] + normals[k][a] * offset
        }));
    }
}

/// Whether `triangles` of `points` are a thin planar patch within `tolerance` — their box's least
/// side, else their spread along the largest triangle's normal —, and their thickness across it.
fn thin(points: &[[f64; 3]], triangles: &[[usize; 3]], tolerance: f64) -> Option<f64> {
    let (low, high) = aabb_of(triangles.iter().flatten().map(|&v| points[v]));
    let (mut largest, mut normal) = (0.0f64, [0.0f64, 1.0, 0.0]);
    for t in triangles {
        let [a, b, c] = t.map(|v| points[v]);
        let n = cross(sub(b, a), sub(c, a));
        let area = length(n);
        if area > largest {
            largest = area;
            normal = n.map(|x| x / area);
        }
    }
    let dims: [f64; 3] = std::array::from_fn(|k| high[k] - low[k]);
    let least = dims.iter().copied().fold(f64::MAX, f64::min);
    if least < tolerance {
        return Some(least);
    }
    let (mut near, mut far) = (f64::MAX, f64::MIN);
    for p in triangles.iter().flatten().map(|&v| points[v]) {
        let d = dot(p, normal);
        near = near.min(d);
        far = far.max(d);
        if far - near > tolerance {
            return None;
        }
    }
    Some(far - near)
}

/// The parts of `meshes`: solids into the winding field, thin parts into shells, tiny thin parts
/// dropped, and the seed points of each.
pub(super) fn scene(meshes: &[Mesh], accuracy: f64) -> Option<Scene> {
    let thickness = MIN_THICKNESS * accuracy;
    // A speck: a hundredth of `TINY_PART` voxels. Only dust far under a voxel is dropped; any
    // part large enough to show at the accuracy is kept, however thin.
    let tiny = TINY_PART * accuracy / 100.0;
    // Each mesh's parts side by side, gathered in mesh order: the same field as one after the
    // other, the bounds a minimum and a maximum.
    let each: Vec<Parts> = meshes
        .par_iter()
        .filter(|(_, corners)| !corners.is_empty())
        .map(|&(positions, corners)| mesh_parts((positions, corners), thickness, tiny))
        .collect();
    let (mut solid, mut shell, mut radius, mut seeds) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut parts: Vec<Vec<f32>> = Vec::new();
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for mesh in each {
        solid.extend(mesh.solid);
        shell.extend(mesh.shell);
        radius.extend(mesh.radius);
        seeds.extend(mesh.seeds);
        parts.extend(mesh.parts);
        merge_aabb(&mut low, &mut high, mesh.bounds.0, mesh.bounds.1);
    }
    if low[0] > high[0] {
        return None;
    }
    // The closed parts' fields, the open solids' and the shells side by side.
    let (winding, shells) =
        rayon::join(|| Winding::new(solid, parts), || Shells::new(shell, radius));
    Some(Scene {
        winding,
        shells,
        bounds: (low, high),
        seeds,
    })
}

/// One mesh's share of the scene (`scene`): its open solids, its thin parts' triangles and
/// radii, its closed parts, its seed points and its bounds.
struct Parts {
    pub(super) solid: Vec<f32>,
    pub(super) shell: Vec<f32>,
    pub(super) radius: Vec<f64>,
    pub(super) parts: Vec<Vec<f32>>,
    pub(super) seeds: Vec<[f64; 3]>,
    pub(super) bounds: ([f64; 3], [f64; 3]),
}

/// The parts of one placed mesh (`scene`) at the desired `thickness`, a thin one smaller than
/// `tiny` dropped.
fn mesh_parts((positions, corners): Mesh, thickness: f64, tiny: f64) -> Parts {
    let (mut solid, mut shell, mut radius, mut seeds) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut parts: Vec<Vec<f32>> = Vec::new();
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut grow = |p: [f64; 3], r: f64| {
        extend_aabb(&mut low, &mut high, p.map(|x| x - r));
        extend_aabb(&mut low, &mut high, p.map(|x| x + r));
    };
    let (welded, indices, _) = crate::qem::welded_region(positions, corners);
    let points: Vec<[f64; 3]> = (welded.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let tris: Vec<[usize; 3]> = (indices.as_chunks::<3>().0.iter())
        .map(|t| t.map(|v| v as usize))
        .collect();
    // Connected components, by shared vertices.
    let mut join = Join::new(points.len());
    for t in &tris {
        join.unite(t[0] as u32, t[1] as u32);
        join.unite(t[0] as u32, t[2] as u32);
    }
    // Each component numbered by its first triangle, its triangles in order.
    let mut rank_of_root = vec![u32::MAX; points.len()];
    let mut components: Vec<Vec<usize>> = Vec::new();
    for (at, t) in tris.iter().enumerate() {
        let root = join.root(t[0] as u32) as usize;
        if rank_of_root[root] == u32::MAX {
            rank_of_root[root] = components.len() as u32;
            components.push(Vec::new());
        }
        components[rank_of_root[root] as usize].push(at);
    }
    drop(rank_of_root);
    // Vertex normals of the welded mesh, for the shells' seeds.
    let vertex_normal =
        super::super::mesh_merge::vertex_normals(points.len(), |v| points[v], tris.iter().copied());
    let mut solid_vertices: Vec<usize> = Vec::new();
    let mut edges: Vec<u64> = Vec::new();
    for component in components {
        let own: Vec<[usize; 3]> = component.iter().map(|&t| tris[t]).collect();
        // Closed when every edge is named at least twice.
        edges.clear();
        edges.extend(
            own.iter()
                .flat_map(|t| [0, 1, 2].map(|k| edge_key(t[k] as u32, t[(k + 1) % 3] as u32))),
        );
        edges.sort_unstable();
        let closed = edges.chunk_by(|a, b| a == b).all(|run| run.len() >= 2);
        let push = |into: &mut Vec<f32>, t: &[usize; 3]| {
            for &v in t {
                into.extend(points[v].map(|x| x as f32));
            }
        };
        // A closed part also counts inside by its winding number.
        let mut part = Vec::new();
        match thin(&points, &own, thickness) {
            Some(depth) => {
                // A tiny thin part is dropped.
                let (lo, hi) = aabb_of(own.iter().flatten().map(|&v| points[v]));
                if longest_side(lo, hi) < tiny {
                    continue;
                }
                // Open, it has no thickness; closed, its own up to the desired one.
                let own_thickness = if closed { depth.min(thickness) } else { 0.0 };
                let r = 0.5 * (thickness - own_thickness);
                for t in &own {
                    push(&mut shell, t);
                    radius.push(r);
                    if closed {
                        push(&mut part, t);
                    }
                    for &v in t {
                        grow(points[v], r);
                    }
                }
                let vertices: Vec<usize> = {
                    let mut seen: Vec<usize> = own.iter().flatten().copied().collect();
                    seen.sort_unstable();
                    seen.dedup();
                    seen
                };
                let at: Vec<[f64; 3]> = vertices.iter().map(|&v| points[v]).collect();
                let normals: Vec<[f64; 3]> = vertices.iter().map(|&v| vertex_normal[v]).collect();
                seed_points(&at, &normals, r, &mut seeds);
            }
            None => {
                for t in &own {
                    push(if closed { &mut part } else { &mut solid }, t);
                    for &v in t {
                        grow(points[v], 0.0);
                        solid_vertices.push(v);
                    }
                }
            }
        }
        if closed {
            parts.push(part);
        }
    }
    solid_vertices.sort_unstable();
    solid_vertices.dedup();
    let at: Vec<[f64; 3]> = solid_vertices.iter().map(|&v| points[v]).collect();
    seed_points(&at, &vec![[0.0; 3]; at.len()], 0.0, &mut seeds);
    Parts {
        solid,
        shell,
        radius,
        parts,
        seeds,
        bounds: (low, high),
    }
}
