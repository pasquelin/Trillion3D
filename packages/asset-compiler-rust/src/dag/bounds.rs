//! The bounds of the DAG's clusters: the box a page draws in (`cluster_bounds`), and the balls
//! an error is projected through (`points_ball`, `balls_ball`), in single precision, which the page
//! codec holds for every builder that bounds a cluster, a group or a culling node
//! (`trillion3d_page_codec::balls`).
use trillion3d_math::geometry::aabb::{aabb_of, aabb_of_boxes};
use trillion3d_math::vector::vec3::point;
pub(crate) use trillion3d_page_codec::balls::{balls_ball, points_ball};
use trillion3d_page_codec::culling::CullingCluster;

/// Box of the vertices a cluster's triangles use; an empty cluster, or one whose low x is not
/// finite, gets a zero box.
pub(crate) fn cluster_bounds(positions: &[f32], indices: &[u32]) -> ([f64; 3], [f64; 3]) {
    let (min, max) = aabb_of(indices.iter().map(|&id| point(positions, id)));
    if !min[0].is_finite() {
        return ([0.0; 3], [0.0; 3]);
    }
    (min, max)
}

impl super::DagCluster {
    /// The box its page draws in, over `positions`: its own vertices' (`cluster_bounds`), merged
    /// with the whole cluster's for a half of one (`whole_box`, measured over the source
    /// positions), so that the box holds the positions it is asked over as well.
    pub(crate) fn drawn_box(&self, positions: &[f32]) -> ([f64; 3], [f64; 3]) {
        let own = cluster_bounds(positions, &self.indices);
        (self.whole_box).map_or(own, |whole| aabb_of_boxes([own, whole]))
    }
}

/// The DAG's clusters as the culling hierarchy's parts are made of them
/// (`crate::compiler::hierarchy::culling_parts`): each its box (`DagCluster::drawn_box`) over
/// `positions` — the positions its pages decode to —, level and replacement band.
pub(crate) fn culling_clusters(
    positions: &[f32],
    dag: &[super::DagCluster],
) -> Vec<CullingCluster> {
    dag.iter()
        .map(|cluster| {
            let (min, max) = cluster.drawn_box(positions);
            CullingCluster {
                min,
                max,
                level: cluster.level,
                parent_sphere: cluster.parent_sphere,
                parent_error: cluster.parent_error,
            }
        })
        .collect()
}
