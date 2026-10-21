//! The band's distances read on the GPU (`gpu/nearest.wgsl`): the mesh's triangles packed once in
//! the leaf order of the compiler's tree over them, about their bounds' centre, then each front of
//! nodes sent as one list.
use super::Mesh;
use crate::hlod::flatten::approximate::gpu::layout::HEAD_RECORDS;
use crate::hlod::flatten::approximate::gpu::pack::{check_depth, pack_boxed_nodes, pack_triangles};
use crate::hlod::flatten::approximate::gpu::{Head, Pass, Queries};
use crate::hlod::flatten::bake::tree::Tree;
use crate::hlod::flatten::gpu::pack::base;
use std::sync::atomic::AtomicBool;
use trillion3d_math::geometry::aabb::centre;

/// A mesh on the device, answering the distance to its nearest triangle within a limit.
pub(super) struct Nearest<'a>(Queries<'a>);

impl<'a> Nearest<'a> {
    /// `mesh` packed and uploaded, each triangle measured on its own corners, each query within
    /// `limit`; its waits stop when `cancelled` is raised.
    pub fn new(mesh: &Mesh, limit: f64, cancelled: &'a AtomicBool) -> crate::Result<Self> {
        let soup: Vec<f32> = (0..mesh.triangles.len())
            .flat_map(|t| mesh.corners(t).into_iter().flatten().map(|x| x as f32))
            .collect();
        let tree = Tree::from_soup(soup);
        check_depth(&tree.nodes)?;
        let (low, high) = mesh.triangle_bounds();
        let origin = centre(low, high);
        let mut words = vec![0u32; HEAD_RECORDS * 4];
        let triangles = base(&words);
        let corners = |slot: usize| mesh.corners(tree.rank(slot));
        let count = mesh.triangles.len();
        let packed = pack_triangles(&mut words, count, corners, origin);
        let nodes = base(&words);
        pack_boxed_nodes(&mut words, &tree.nodes, &packed);
        let mut head: Head = [0; HEAD_RECORDS * 4];
        let limit = (limit as f32).to_bits();
        head[..4].copy_from_slice(&[nodes, triangles, tree.nodes.len() as u32, limit]);
        words[..head.len()].copy_from_slice(&head);
        Ok(Self(Queries::new(
            Pass::Nearest,
            &words,
            origin,
            cancelled,
        )?))
    }

    /// The distance from each of `points` to its nearest triangle, `None` where none lies within
    /// the limit.
    pub fn distances(&mut self, points: &[[f64; 3]]) -> crate::Result<Vec<Option<f32>>> {
        let values = self.0.values(points)?;
        Ok(values
            .into_iter()
            .map(|d| (d >= 0.0).then_some(d))
            .collect())
    }
}
