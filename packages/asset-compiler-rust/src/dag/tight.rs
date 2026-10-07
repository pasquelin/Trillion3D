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
use super::bounds::{bounding_sphere, enclosing_sphere};
use super::{DagCluster, DagGroup};
use rayon::prelude::*;
use trillion3d_math::aabb::aabb_of_boxes;
use trillion3d_math::vec3::{length, point, sub};
use trillion3d_page_codec::min_ball::min_ball;

/// Iterations of the centre pull toward the farthest ball, with a shrinking step.
const WALK_STEPS: usize = 64;
/// Relative margin a tightened sphere is inflated by, of its coordinates' magnitude: containment
/// then survives the float64 rounding of any re-check (8.5e-14 m outside without it at 1 km).
const CONTAINMENT_MARGIN: f64 = 1e-12;

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

/// The radius a sphere centred on `c` needs to enclose every live sphere of `spheres`.
fn radius_for(c: [f64; 3], spheres: &[[f64; 4]]) -> f64 {
    spheres
        .iter()
        .map(|s| length(sub([s[0], s[1], s[2]], c)) + s[3])
        .fold(0.0, f64::max)
}

/// A sphere enclosing `spheres` (those of negative radius are absent), never larger than
/// [`enclosing_sphere`]'s: the smallest of that merge's centre, the centre of the spheres' box
/// and the steps of a centre pull toward the far point of the farthest ball. Each radius is
/// recomputed as `max |c_i - C| + r_i`, the rule the runtime's containment proof reads.
pub fn ball_of_balls(spheres: &[[f64; 4]]) -> [f64; 4] {
    let merged = enclosing_sphere(spheres);
    let live: Vec<[f64; 4]> = spheres.iter().copied().filter(|s| s[3] >= 0.0).collect();
    if live.len() < 2 {
        return merged;
    }
    let mut best = merged;
    let consider = |c: [f64; 3], best: &mut [f64; 4]| {
        let r = radius_for(c, &live);
        if r < best[3] {
            *best = [c[0], c[1], c[2], r];
        }
    };
    consider([merged[0], merged[1], merged[2]], &mut best);
    let (lo, hi) = aabb_of_boxes(live.iter().map(|s| {
        (
            [0, 1, 2].map(|a| s[a] - s[3]),
            [0, 1, 2].map(|a| s[a] + s[3]),
        )
    }));
    consider([0, 1, 2].map(|a| (lo[a] + hi[a]) * 0.5), &mut best);
    // Pull the centre toward the far point of the farthest ball, by 1/(k + 1) of the way at step k.
    let mut c = [best[0], best[1], best[2]];
    for k in 1..=WALK_STEPS {
        let far = live
            .iter()
            .map(|s| (length(sub([s[0], s[1], s[2]], c)) + s[3], s))
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, s)| *s)
            .expect("two live spheres");
        let dir = sub([far[0], far[1], far[2]], c);
        let l = length(dir);
        let reach = if l > 0.0 { far[3] / l } else { 0.0 };
        let target = [0, 1, 2].map(|a| far[a] + dir[a] * reach);
        let t = 1.0 / (k as f64 + 1.0);
        c = [0, 1, 2].map(|a| c[a] + (target[a] - c[a]) * t);
        consider(c, &mut best);
    }
    let magnitude = best[0]
        .abs()
        .max(best[1].abs())
        .max(best[2].abs())
        .max(best[3]);
    best[3] += magnitude * CONTAINMENT_MARGIN;
    if best[3] < merged[3] {
        best
    } else {
        merged
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
