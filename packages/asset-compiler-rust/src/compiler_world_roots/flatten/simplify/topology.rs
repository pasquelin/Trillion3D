//! The mesh read and its neighbourhoods.
use super::super::first_seen::first_seen;
use super::{Mesh, VertexEdges, NONE, V3};
use trillion3d_math::triangle::edge_key;
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{add, dot, scale, sub};

impl Mesh {
    /// The mesh of `indices` over `points`: degenerate, non-manifold and duplicate triangles
    /// dropped. Every corner's edge is first numbered side by side by its key (`first_seen`), so
    /// the pass that keeps the triangles in order finds an edge by its number in constant time.
    pub(super) fn new(points: Vec<V3>, indices: &[u32]) -> Self {
        use rayon::prelude::*;
        let count = points.len();
        let tris = indices.as_chunks::<3>().0;
        let named: Vec<u64> = (tris.par_iter())
            .flat_map_iter(|t| (0..3).map(move |k| edge_key(t[k], t[(k + 1) % 3])))
            .collect();
        let (keys, ranks) = first_seen(named);
        // Per numbered key, the mesh's edge once a kept triangle made it.
        let mut made = vec![NONE; keys.len()];
        drop(keys);
        let mut mesh = Mesh {
            positions: points,
            vertex_edges: vec![VertexEdges::new(); count],
            vertex_alive: vec![true; count],
            triangles: Vec::new(),
            triangle_alive: Vec::new(),
            edges: Vec::new(),
            edge_alive: Vec::new(),
            triangle_count: 0,
        };
        for (at, &tv) in tris.iter().enumerate() {
            if tv[0] == tv[1] || tv[0] == tv[2] || tv[1] == tv[2] {
                continue;
            }
            let rank = |k: usize| ranks[3 * at + k] as usize;
            let found = [0, 1, 2].map(|k| Some(made[rank(k)]).filter(|&e| e != NONE));
            if found
                .iter()
                .any(|e| e.is_some_and(|e| mesh.edges[e as usize].1[1] != NONE))
            {
                continue;
            }
            if let [Some(e0), Some(_), Some(_)] = found {
                let ti = mesh.edges[e0 as usize].1[0] as usize;
                if mesh.triangles[ti].contains(&tv[2]) {
                    continue;
                }
            }
            let tid = mesh.triangles.len() as u32;
            mesh.triangles.push(tv);
            mesh.triangle_alive.push(true);
            mesh.triangle_count += 1;
            for k in 0..3 {
                let (a, b) = (tv[k], tv[(k + 1) % 3]);
                match found[k] {
                    Some(e) => mesh.edges[e as usize].1[1] = tid,
                    None => {
                        let e = mesh.edges.len() as u32;
                        made[rank(k)] = e;
                        mesh.edges.push(([a.min(b), a.max(b)], [tid, NONE]));
                        mesh.edge_alive.push(true);
                        mesh.vertex_edges[a as usize].push(e);
                        mesh.vertex_edges[b as usize].push(e);
                    }
                }
            }
        }
        // Vertices no triangle uses are not the mesh's.
        for v in 0..count {
            if mesh.vertex_edges[v].is_empty() {
                mesh.vertex_alive[v] = false;
            }
        }
        mesh
    }

    pub(super) fn other(&self, e: u32, v: u32) -> u32 {
        let [a, b] = self.edges[e as usize].0;
        if a == v {
            b
        } else {
            a
        }
    }

    pub(super) fn find_edge(&self, a: u32, b: u32) -> Option<u32> {
        (self.vertex_edges[a as usize].iter().copied()).find(|&e| self.other(e, a) == b)
    }

    pub(super) fn boundary_edge(&self, e: u32) -> bool {
        self.edges[e as usize].1[1] == NONE
    }

    /// Each triangle about `v` once: it holds two of `v`'s edges and is taken from the one that
    /// leads to the corner after `v` in its winding.
    pub(super) fn vertex_triangles(&self, v: u32) -> impl Iterator<Item = u32> + '_ {
        self.vertex_edges[v as usize].iter().flat_map(move |&e| {
            let w = self.other(e, v);
            self.edges[e as usize].1.into_iter().filter(move |&t| {
                t != NONE && {
                    let tri = self.triangles[t as usize];
                    let k = (0..3).find(|&k| tri[k] == v).unwrap_or(0);
                    tri[(k + 1) % 3] == w
                }
            })
        })
    }

    pub(super) fn other_vertex(&self, t: u32, a: u32, b: u32) -> u32 {
        *self.triangles[t as usize]
            .iter()
            .find(|&&v| v != a && v != b)
            .unwrap_or(&NONE)
    }

    /// Triangle `t`'s unit normal, the area, the centroid.
    pub(super) fn triangle_info(&self, t: u32) -> (V3, f64, V3) {
        let [a, b, c] = self.triangles[t as usize].map(|v| self.positions[v as usize]);
        let n = cross(sub(b, a), sub(c, a));
        let length = dot(n, n).sqrt();
        let unit = if length > f64::EPSILON {
            scale(n, 1.0 / length)
        } else {
            [0.0; 3]
        };
        let centroid = scale(add(add(a, b), c), 1.0 / 3.0);
        (unit, 0.5 * length, centroid)
    }

    pub(super) fn replace_edge_triangle(&mut self, e: u32, old: u32, new: u32) {
        let tris = &mut self.edges[e as usize].1;
        if tris[0] == old {
            if new == NONE {
                tris[0] = tris[1];
                tris[1] = NONE;
            } else {
                tris[0] = new;
            }
        } else if tris[1] == old {
            tris[1] = new;
        }
    }

    pub(super) fn remove_from(&mut self, v: u32, e: u32) {
        let list = &mut self.vertex_edges[v as usize];
        if let Some(at) = list.iter().position(|&x| x == e) {
            list.remove(at);
        }
    }
}
