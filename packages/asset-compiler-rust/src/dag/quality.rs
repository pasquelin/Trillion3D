//! What a cook checks on a finished DAG before it publishes it (`check`): its error never drops
//! from a cluster to its parent, the nesting a runtime cut relies on. And the face normal the
//! cook's tests read a coarse triangle by.
use crate::dag::DagCluster;
use crate::{CompilerError, Result};

/// Refuses a DAG whose error drops from a cluster to the group replacing it — a runtime cut would
/// then draw both or neither. A reduction's error is never below its children's (`solved.rs`), so
/// a sound build never meets it; nothing else is refused.
pub fn check(dag: &[DagCluster]) -> Result<()> {
    match dag.iter().find(|c| c.parent_error < c.lod_error) {
        Some(c) => Err(CompilerError::new(
            "DAG_ERROR_NOT_MONOTONE",
            format!(
                "A level {} cluster has error {} above its parent's {}",
                c.level, c.lod_error, c.parent_error
            ),
        )),
        None => Ok(()),
    }
}

/// A triangle thinner than this share of its longest edge draws a line, not a face: its face
/// normal is rounding noise (measured: three corners on one arc, 180° from their normals).
#[cfg(test)]
const SLIVER: f64 = 1e-3;

/// Unit face normal of a triangle by its winding, and its width — its height over its longest
/// edge; `None` for a sliver.
#[cfg(test)]
pub(crate) fn face_normal(positions: &[f32], tri: &[u32; 3]) -> Option<([f64; 3], f64)> {
    use trillion3d_math::triangle::triangle_cross;
    use trillion3d_math::vec3::{point_checked, unit};
    use trillion3d_math::vecn::{length, sub};
    let [a, b, c] = [tri[0], tri[1], tri[2]].map(|v| point_checked(positions, v));
    let (a, b, c) = (a?, b?, c?);
    let normal = triangle_cross(a, b, c);
    // |normal| is twice the area, the longest edge times the width.
    let longest = length(sub(b, a))
        .max(length(sub(c, a)))
        .max(length(sub(c, b)));
    let area2 = length(normal);
    (area2 > SLIVER * longest * longest).then(|| unit(normal).map(|n| (n, area2 / longest)))?
}
