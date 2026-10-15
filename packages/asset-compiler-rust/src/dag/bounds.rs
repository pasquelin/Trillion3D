use trillion3d_math::aabb::{aabb_of, centre};
use trillion3d_math::vec3::point;
use trillion3d_math::vecn::{length, sub};
use trillion3d_page_codec::culling::CullingCluster;
use trillion3d_page_codec::min_ball::min_ball;

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

/// The smallest sphere of `indices`' vertices (`min_ball`), the one sphere a level-0 cluster is
/// projected with: its radius re-measured in float64 from the final centre, so every vertex is
/// inside by construction, not by the solver. No vertex, or one that is not a number, gives the
/// zero sphere.
pub fn point_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let mut ids = indices.to_vec();
    ids.sort_unstable();
    ids.dedup();
    // `min_ball` reorders the points; the radius re-measured below does not depend on their order.
    let mut points: Vec<[f64; 3]> = ids.iter().map(|&v| point(positions, v)).collect();
    let Some((c, _)) = min_ball(&mut points) else {
        return [0.0; 4];
    };
    let radius = points
        .iter()
        .map(|&p| length(sub(p, c)))
        .fold(0.0, f64::max);
    if c.iter().all(|v| v.is_finite()) && radius.is_finite() {
        [c[0], c[1], c[2], radius]
    } else {
        [0.0; 4]
    }
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
