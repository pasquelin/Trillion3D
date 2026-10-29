//! The band's distances read on the GPU (`gpu/nearest.wgsl`): the mesh's triangles packed once in
//! the leaf order of the compiler's tree over them, about their bounds' centre, in as many parts
//! as one GPU binding asks, then each front of nodes sent as one list.
use super::Mesh;
use crate::hlod::flatten::approximate::gpu::layout::{
    BOX_NODE_RECORDS, HEAD_RECORDS, TRIANGLE_RECORDS,
};
use crate::hlod::flatten::approximate::gpu::pack::{check_depth, pack_boxed_nodes, pack_triangles};
use crate::hlod::flatten::approximate::gpu::{part_bytes, split_to_fit, Head, Pass, Queries};
use crate::hlod::flatten::bake::tree::Tree;
use crate::hlod::flatten::gpu::pack::base;
use std::sync::atomic::AtomicBool;
use trillion3d_math::geometry::aabb::{aabb_of, centre, longest_axis};
use trillion3d_page_codec::proxy::PROXY_LEAF_TRIANGLES;

/// A mesh on the device, answering the distance to its nearest triangle within a limit.
pub(super) struct Nearest<'a>(Queries<'a>);

/// Triangles `picked` of `mesh` packed as the nearest pass reads them, about their bounds' centre,
/// each measured on its own corners, each query within `limit`; the words and that centre.
fn pack_part(mesh: &Mesh, picked: &[usize], limit: f64) -> crate::Result<(Vec<u32>, [f64; 3])> {
    let soup: Vec<f32> = picked
        .iter()
        .flat_map(|&t| mesh.corners(t).into_iter().flatten().map(|x| x as f32))
        .collect();
    let tree = Tree::from_soup(soup);
    check_depth(&tree.nodes)?;
    let (low, high) = aabb_of(picked.iter().flat_map(|&t| mesh.corners(t)));
    let origin = centre(low, high);
    let mut words = vec![0u32; HEAD_RECORDS * 4];
    let triangles = base(&words);
    let corners = |slot: usize| mesh.corners(picked[tree.rank(slot)]);
    let packed = pack_triangles(&mut words, picked.len(), corners, origin);
    let nodes = base(&words);
    pack_boxed_nodes(&mut words, &tree.nodes, &packed);
    let mut head: Head = [0; HEAD_RECORDS * 4];
    let limit = (limit as f32).to_bits();
    head[..4].copy_from_slice(&[nodes, triangles, tree.nodes.len() as u32, limit]);
    words[..head.len()].copy_from_slice(&head);
    Ok((words, origin))
}

/// The bytes `count` triangles take packed: the head, the triangles, and at most the nodes of a
/// tree whose every leaf holds at least half of `PROXY_LEAF_TRIANGLES` (`bake::tree`).
fn part_size(count: usize) -> u64 {
    let nodes = 2 * count.div_ceil(PROXY_LEAF_TRIANGLES / 2).max(1);
    4 * (HEAD_RECORDS * 4 + count * TRIANGLE_RECORDS * 4 + nodes * BOX_NODE_RECORDS * 4) as u64
}

/// Triangles `picked` halved along the longest side of their bounds, by their corners' sums.
fn halve(mesh: &Mesh, mut picked: Vec<usize>) -> (Vec<usize>, Vec<usize>) {
    let (low, high) = aabb_of(picked.iter().flat_map(|&t| mesh.corners(t)));
    let axis = longest_axis(low, high);
    let side = |t: &usize| mesh.corners(*t).iter().map(|c| c[axis]).sum::<f64>();
    picked.sort_by(|a, b| side(a).total_cmp(&side(b)));
    let upper = picked.split_off(picked.len() / 2);
    (picked, upper)
}

impl<'a> Nearest<'a> {
    /// `mesh` packed and uploaded, in as many parts as one GPU binding asks, each triangle
    /// measured on its own corners, each query within `limit`; its waits stop when `cancelled` is
    /// raised.
    pub fn new(mesh: &Mesh, limit: f64, cancelled: &'a AtomicBool) -> crate::Result<Self> {
        let mut parts = Vec::new();
        let size = |picked: &[usize]| part_size(picked.len());
        split_to_fit(
            (0..mesh.triangles.len()).collect(),
            (&size, part_bytes()?, "triangle"),
            &|picked| halve(mesh, picked),
            &mut |picked| {
                parts.push(pack_part(mesh, &picked, limit)?);
                Ok(())
            },
        )?;
        Ok(Self(Queries::new(Pass::Nearest, &parts, cancelled)?))
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
