//! What a cook checks on a finished DAG before it publishes it: per level, the largest normal
//! deviation and the largest error, and the two refusals they carry.
//!
//! The normal deviation of a triangle is the angle between its face normal and the normal its
//! centre is shaded with, the mean of its three corner normals. A coarse level whose corners point
//! at the normals of another face — the underside of a slab on its top — shows it as an angle near
//! 180°, and the face turns black under a light it faces. One corner alone facing away is a
//! coarse face spanning a fold, whose shading the source had too: the mean stays on the face's side.
//!
//! A triangle no wider than its level's error is exempt: when the runtime draws that level, the
//! error, and so the triangle's width, is under a pixel — a column the level flattened into a
//! sliver draws a line, whatever its normals. Its error already said what it lost.
use super::DagCluster;
use crate::shared_math::{cross, dot, length, scale, sub};
use crate::{CompilerError, Result};
use rayon::prelude::*;

/// Largest angle, in degrees, a coarse level may put between a face and the normal its centre is
/// shaded with, unless the source itself already goes further. Past 90° the face is lit from
/// behind: black under a light it faces.
pub const NORMAL_DEVIATION_BOUND: f64 = 90.0;

/// The bound of a primitive whose source deviates by `source` degrees.
pub fn deviation_bound(source: f64) -> f64 {
    NORMAL_DEVIATION_BOUND.max(source)
}

/// One level of a DAG as the compile report publishes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LevelQuality {
    pub level: usize,
    /// Largest face normal deviation of the level, in degrees; zero without normals.
    pub normal_deviation: f64,
    /// Largest `lod_error` of the level.
    pub error_max: f64,
}

/// Largest normal deviation, in degrees, over the triangles of `indices` wider than `error`.
pub fn normal_deviation(indices: &[u32], positions: &[f32], normals: &[f32], error: f64) -> f64 {
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter_map(|tri| triangle_deviation(tri, positions, normals, error))
        .fold(0.0, f64::max)
}

/// The corners, welded, sorted and once each, of the triangles of `indices` wider than `error`
/// whose deviation exceeds `bound`: those a reduction retries with locked.
pub(super) fn backlit_corners(
    indices: &[u32],
    positions: &[f32],
    normals: &[f32],
    weld: &[u32],
    (error, bound): (f64, f64),
) -> Vec<u32> {
    let mut corners: Vec<u32> = indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|tri| triangle_deviation(tri, positions, normals, error).is_some_and(|d| d > bound))
        .flatten()
        .map(|&corner| weld[corner as usize])
        .collect();
    corners.sort_unstable();
    corners.dedup();
    corners
}

/// Deviation of one triangle, in degrees, when it is wider than `error`. A sliver has no face
/// normal and a triangle whose corners carry no normal, or cancel out, has nothing to deviate.
fn triangle_deviation(
    tri: &[u32; 3],
    positions: &[f32],
    normals: &[f32],
    error: f64,
) -> Option<f64> {
    let (face, _) = face_normal(positions, tri).filter(|&(_, width)| width > error)?;
    let mean = tri
        .iter()
        .filter_map(|&corner| unit_normal(normals, corner))
        .fold([0.0; 3], |sum, n| {
            [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]]
        });
    let shading = unit(mean)?;
    Some(dot(face, shading).clamp(-1.0, 1.0).acos().to_degrees())
}

/// Three floats of `values` at vertex `v`, if it has them.
fn vector(values: &[f32], v: u32) -> Option<[f64; 3]> {
    let i = v as usize * 3;
    values
        .get(i..i + 3)
        .map(|n| [n[0] as f64, n[1] as f64, n[2] as f64])
}

/// Unit normal of vertex `v`, if it has a non-zero one.
pub(super) fn unit_normal(normals: &[f32], v: u32) -> Option<[f64; 3]> {
    vector(normals, v).and_then(unit)
}

/// A triangle thinner than this share of its longest edge draws a line, not a face: its face
/// normal is rounding noise (measured: three corners on one arc, 180° from their normals).
const SLIVER: f64 = 1e-3;

/// Unit face normal of a triangle by its winding, and its width — its height over its longest
/// edge; `None` for a sliver.
pub(super) fn face_normal(positions: &[f32], tri: &[u32; 3]) -> Option<([f64; 3], f64)> {
    let [a, b, c] = [tri[0], tri[1], tri[2]].map(|v| vector(positions, v));
    let (a, b, c) = (a?, b?, c?);
    let normal = cross(sub(b, a), sub(c, a));
    // |normal| is twice the area, the longest edge times the width.
    let longest = length(sub(b, a))
        .max(length(sub(c, a)))
        .max(length(sub(c, b)));
    let area2 = length(normal);
    (area2 > SLIVER * longest * longest).then(|| unit(normal).map(|n| (n, area2 / longest)))?
}

fn unit(v: [f64; 3]) -> Option<[f64; 3]> {
    let length = length(v);
    (length > 0.0 && length.is_finite()).then(|| scale(v, 1.0 / length))
}

/// Per level, in level order, the largest normal deviation and the largest error.
pub fn level_quality(
    dag: &[DagCluster],
    positions: &[f32],
    normals: Option<&[f32]>,
) -> Vec<LevelQuality> {
    let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
    let per_cluster: Vec<(usize, f64, f64)> = dag
        .par_iter()
        .map(|c| {
            let deviation = normals.map_or(0.0, |n| {
                normal_deviation(&c.indices, positions, n, c.lod_error)
            });
            (c.level, deviation, c.lod_error)
        })
        .collect();
    let mut levels: Vec<LevelQuality> = (0..=depth)
        .map(|level| LevelQuality {
            level,
            normal_deviation: 0.0,
            error_max: 0.0,
        })
        .collect();
    for (level, deviation, error) in per_cluster {
        let row = &mut levels[level];
        row.normal_deviation = row.normal_deviation.max(deviation);
        row.error_max = row.error_max.max(error);
    }
    levels
}

/// Refuses a DAG whose error drops from a cluster to the group replacing it — a runtime cut would
/// then draw both or neither — or whose coarse level bends a normal past
/// `NORMAL_DEVIATION_BOUND`, or past the source's own worst when that is larger.
pub fn check(dag: &[DagCluster], quality: &[LevelQuality]) -> Result<()> {
    if let Some(c) = dag.iter().find(|c| c.parent_error < c.lod_error) {
        return Err(CompilerError::new(
            "DAG_ERROR_NOT_MONOTONE",
            format!(
                "A level {} cluster has error {} above its parent's {}",
                c.level, c.lod_error, c.parent_error
            ),
        ));
    }
    let bound = deviation_bound(quality.first().map_or(0.0, |q| q.normal_deviation));
    match quality.iter().skip(1).find(|q| q.normal_deviation > bound) {
        Some(q) => Err(CompilerError::new(
            "DAG_NORMAL_DEVIATION",
            format!(
                "Level {} bends a normal {:.1}° from its face, past the {:.1}° bound",
                q.level, q.normal_deviation, bound
            ),
        )),
        None => Ok(()),
    }
}
