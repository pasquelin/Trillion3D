use trillion3d_math::aabb::{aabb_of, centre};
use trillion3d_math::vec3::{length, point, sub};
use trillion3d_page_codec::culling::CullingCluster;

/// Monotone parent bounds: the sphere enclosing every input sphere, merged in order.
pub use trillion3d_math::sphere::enclosing_sphere;

/// AABB centre plus the farthest vertex. Conservative and deterministic.
pub fn bounding_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let (min, max) = aabb_of(indices.iter().map(|&id| point(positions, id)));
    if !min[0].is_finite() {
        return [0.0, 0.0, 0.0, 0.0];
    }
    let centre = centre(min, max);
    let mut radius = 0.0_f64;
    for &id in indices {
        let p = point(positions, id);
        let d = length(sub(p, centre));
        if d > radius {
            radius = d;
        }
    }
    [centre[0], centre[1], centre[2], radius]
}

/// Box of the vertices a cluster's triangles use; an empty cluster, or one whose low x is not
/// finite, gets a zero box.
pub(crate) fn cluster_bounds(positions: &[f32], indices: &[u32]) -> ([f64; 3], [f64; 3]) {
    let (min, max) = aabb_of(indices.iter().map(|&id| point(positions, id)));
    if !min[0].is_finite() {
        return ([0.0; 3], [0.0; 3]);
    }
    (min, max)
}

/// The DAG's clusters as the culling hierarchy builder takes them
/// (`trillion3d_page_codec::culling::build_culling_bvh`): each its box, level and replacement band.
pub(crate) fn culling_clusters(
    positions: &[f32],
    dag: &[super::DagCluster],
) -> Vec<CullingCluster> {
    dag.iter()
        .map(|cluster| {
            let (min, max) = cluster_bounds(positions, &cluster.indices);
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
