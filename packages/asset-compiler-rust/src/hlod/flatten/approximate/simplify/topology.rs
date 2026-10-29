//! The mesh read and the geometry read off it.
use super::{Simplifier, V3};
use crate::hlod::flatten::mesh::Mesh;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The mesh of `indices` over `count` vertices: degenerate, non-manifold and duplicate triangles
/// dropped, the others appended in order.
pub(super) fn read(count: usize, indices: &[u32]) -> Mesh {
    let mut mesh = Mesh::shrinking(count);
    for tri in indices.as_chunks::<3>().0 {
        // A triangle the mesh refuses is not the mesh's.
        let _ = mesh.append(tri.map(|v| v as usize));
    }
    mesh
}

impl Simplifier {
    /// The positions of edge `e`'s two vertices.
    pub(super) fn edge_points(&self, e: usize) -> [V3; 2] {
        self.mesh.ends(e).map(|v| self.positions[v])
    }

    /// Triangle `t`'s unit normal, the area, the centroid.
    pub(super) fn triangle_info(&self, t: usize) -> (V3, f64, V3) {
        let [a, b, c] = self.mesh.corners(t).map(|v| self.positions[v]);
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
}
