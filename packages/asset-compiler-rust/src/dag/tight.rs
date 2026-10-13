//! Tighter projection spheres for the finished cluster DAG.
//!
//! The builder's spheres are an AABB-centre sphere per level-0 cluster and a sequential merge per
//! group (`bounds.rs`). The runtime projects every error with them, so a looser sphere only draws
//! more triangles. Once the DAG is built, this pass recomputes each of them:
//! * a level-0 cluster's as the smallest ball of its vertices (`min_ball`), its radius re-measured
//!   in float64 from the final centre, so every vertex is inside by construction, not by the
//!   solver;
//! * a group's as [`ball_of_balls`] of its children's, so every parent sphere still encloses its
//!   children's: the invariant the cut's monotonicity rests on.
//!
//! Every sphere is also kept no larger than the one it replaces, which falls back bit for bit.
use super::bounds::bounding_sphere;
use super::{DagCluster, DagGroup};
use rayon::prelude::*;
use trillion3d_math::vec3::{length, point, sub};
use trillion3d_page_codec::min_ball::{ball_of_balls, min_ball};

/// The smallest sphere of `indices`' vertices, never larger than [`bounding_sphere`]'s.
pub fn point_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let base = bounding_sphere(positions, indices);
    let mut ids = indices.to_vec();
    ids.sort_unstable();
    ids.dedup();
    // `min_ball` reorders the points; the radius re-measured below does not depend on their order.
    let mut points: Vec<[f64; 3]> = ids.iter().map(|&v| point(positions, v)).collect();
    let Some((c, _)) = min_ball(&mut points) else {
        return base;
    };
    let radius = points
        .iter()
        .map(|&p| length(sub(p, c)))
        .fold(0.0, f64::max);
    // A centre or radius that is not a number never replaces the builder's sphere.
    if c.iter().all(|v| v.is_finite()) && radius < base[3] {
        [c[0], c[1], c[2], radius]
    } else {
        base
    }
}

/// Recomputes, on a finished DAG, every sphere the runtime projects errors with: the level-0
/// clusters' from their vertices, each group's from its children's. Clusters, groups, errors and
/// indices are untouched. Groups are stored level by level and a group's children come from
/// level 0 or earlier groups, so one pass in order sees every child's final sphere first.
pub fn tighten(dag: &mut [DagCluster], groups: &mut [DagGroup], positions: &[f32]) {
    // A root's parent sphere is its own; the group pass below rewrites every replaced cluster's.
    dag.par_iter_mut()
        .filter(|c| c.level == 0)
        .for_each(|cluster| {
            let sphere = point_sphere(positions, &cluster.indices);
            cluster.sphere = sphere;
            cluster.parent_sphere = sphere;
        });
    for group in groups.iter_mut() {
        let spheres: Vec<[f64; 4]> = group.children.iter().map(|&id| dag[id].sphere).collect();
        let sphere = ball_of_balls(&spheres);
        group.sphere = sphere;
        for &id in &group.children {
            dag[id].parent_sphere = sphere;
        }
        for &id in &group.outputs {
            dag[id].sphere = sphere;
            dag[id].parent_sphere = sphere;
        }
    }
}
