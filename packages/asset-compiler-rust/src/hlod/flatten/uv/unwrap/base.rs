//! The mesh an unwrap works on, made of a topology as a `z`-up mesh's conversion makes one:
//!
//! - its points read in a `z`-up mesh's axes, the scene's second and third exchanged, as a `y`-up
//!   scene is read into a `z`-up one — the patches, islands and maps measure, turn and pick sides
//!   there (`expmap.rs`);
//! - its triangles appended in turn (`Mesh`): one naming a point twice, or repeating a triangle's
//!   corners, left out; one on a side two triangles hold already appended again on copies of the
//!   points of each such side, so that it holds that side alone.
use super::Topology;
use crate::hlod::flatten::mesh::{Mesh, Refusal};
use crate::hlod::flatten::units::swap_axes;

/// The unwrap's mesh: its points, the welded ones then the copies; its triangles; and each
/// triangle's rank in the topology.
pub(super) struct Base {
    pub(super) points: Vec<[f64; 3]>,
    pub(super) mesh: Mesh,
    pub(super) source: Vec<usize>,
}

impl Base {
    /// `topology` made a mesh (module doc).
    pub(super) fn of(topology: &Topology) -> Self {
        let mut points: Vec<[f64; 3]> = (topology.points.iter()).map(|&p| swap_axes(p)).collect();
        let mut mesh = Mesh::with_vertices(points.len());
        let mut source = Vec::new();
        for (t, &tri) in topology.triangles.iter().enumerate() {
            let appended = match mesh.append(tri) {
                Err(Refusal::NonManifold) => {
                    // Each side two triangles hold already: both its corners copied.
                    let full = |k: usize| {
                        let e = mesh.find_edge(tri[k], tri[(k + 1) % 3]);
                        e.is_some_and(|e| !mesh.is_boundary(e))
                    };
                    let mut copied = [false; 3];
                    for k in 0..3 {
                        if full(k) {
                            copied[k] = true;
                            copied[(k + 1) % 3] = true;
                        }
                    }
                    let mut alone = tri;
                    for k in (0..3).filter(|&k| copied[k]) {
                        points.push(points[tri[k]]);
                        alone[k] = mesh.add_vertex();
                    }
                    mesh.append(alone)
                }
                appended => appended,
            };
            if appended.is_ok() {
                source.push(t);
            }
        }
        Self {
            points,
            mesh,
            source,
        }
    }

    /// How many triangles the mesh holds.
    pub(super) fn triangle_count(&self) -> usize {
        self.mesh.triangles.len()
    }

    /// Triangle `t`'s corners' points.
    pub(super) fn corners(&self, t: usize) -> [[f64; 3]; 3] {
        self.mesh.triangles[t].map(|v| self.points[v])
    }
}
