//! An island's triangles as its exponential map reads them: the unwrap's mesh's triangles of the
//! island, in its order, appended to a mesh of their own (`Mesh`), its vertices numbered in the
//! order the triangles first name them. The edge a vertex met first, the boundary's edges and the
//! order the boundary is walked in, a vertex's neighbours and the order the fronts visit them all
//! follow from that one order, the island's own.
use super::base::Base;
use crate::hlod::flatten::mesh::Mesh;
use std::collections::HashMap;

/// An island's triangles, their corners numbered among the island's own vertices (module doc).
pub(super) struct Submesh<'a> {
    points: &'a [[f64; 3]],
    /// Each vertex's rank among the unwrap's mesh's points.
    pub(super) vertices: Vec<usize>,
    pub(super) mesh: Mesh,
}

impl<'a> Submesh<'a> {
    /// The triangles `island` of `base`, in its order. Each appends: the unwrap's mesh holds only
    /// triangles a mesh can hold, and so does any part of it.
    pub(super) fn of(base: &'a Base, island: &[usize]) -> Self {
        let mut local: HashMap<usize, usize> = HashMap::new();
        let mut vertices = Vec::new();
        let triangles: Vec<[usize; 3]> = (island.iter())
            .map(|&t| {
                base.mesh.triangles[t].map(|v| {
                    *local.entry(v).or_insert_with(|| {
                        vertices.push(v);
                        vertices.len() - 1
                    })
                })
            })
            .collect();
        let mut mesh = Mesh::with_vertices(vertices.len());
        for tri in triangles {
            mesh.append(tri)
                .expect("a part of a mesh holds its triangles");
        }
        Self {
            points: &base.points,
            vertices,
            mesh,
        }
    }

    /// Vertex `v`'s point, in the axes the unwrap's mesh reads them in (`base.rs`).
    pub(super) fn point(&self, v: usize) -> [f64; 3] {
        self.points[self.vertices[v]]
    }
}

impl std::ops::Deref for Submesh<'_> {
    type Target = Mesh;

    /// A submesh reads as the mesh it holds.
    fn deref(&self) -> &Mesh {
        &self.mesh
    }
}
