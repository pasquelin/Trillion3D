//! The surface sampled into cells and the joints between triangles.
use super::super::bricks::{bricks, most};
use super::super::raster::{binned, cells, Cell};
use super::super::sample::Probe;
use super::super::seed::SeedGroup;
use super::super::solid::{solid, Voxel};
use super::super::ERROR_PER_SIZE;
use super::{VoxelInputs, Voxelized, GROWTH};
use crate::compiler_page_record::page_deformation;
use crate::compiler_primitive::triangles::read;
use crate::dag::DAG_CLUSTER_TRIANGLES;
use crate::proxy::tracer::vertex;
use crate::surface_trace::Traceable;
use crate::Result;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

/// Triangles as the voxels sample them: their ranks in the mesh's tracer, their boxes and, for a
/// skinned mesh, each one's joint (`u16::MAX` for none).
pub(super) struct Surface<'a> {
    pub(super) probe: &'a Probe<'a>,
    pub(super) range: Range<usize>,
    pub(super) boxes: &'a [([f64; 3], [f64; 3])],
    pub(super) joints: Option<&'a [u16]>,
}

impl<'a> Surface<'a> {
    /// The triangles of `range` alone, a range of this surface's.
    pub(super) fn within(&self, range: Range<usize>) -> Surface<'a> {
        let local = range.start - self.range.start..range.end - self.range.start;
        Surface {
            probe: self.probe,
            boxes: &self.boxes[local.clone()],
            joints: self.joints.map(|j| &j[local]),
            range,
        }
    }
}

/// `group` drawn as voxels, its children drawn at `child_error`, when a side fits its budget with
/// an error below `beat` — every side tried is sampled, not estimated: the rays drop the voxels a
/// surface only grazes, however many the triangles touch —; its triangles are ranks from the
/// start of `surface`. A side without length covers nothing, and none that keeps no voxel fits.
pub(super) fn voxelize(
    surface: &Surface<'_>,
    group: &SeedGroup,
    child_error: f64,
    beat: f64,
) -> Option<Voxelized> {
    let world = &surface.probe.mesh.world;
    let start = surface.range.start;
    let corners = |t: usize| [0, 1, 2].map(|k| vertex(world, t, k));
    let budget = (
        group.target_voxels(),
        group.num_parents.max(1) * DAG_CLUSTER_TRIANGLES,
    );
    // A voxel wider than twice the triangles' extent covers no more of them than one as wide.
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &t in &group.triangles {
        for corner in corners(start + t as usize) {
            low = std::array::from_fn(|k| low[k].min(corner[k]));
            high = std::array::from_fn(|k| high[k].max(corner[k]));
        }
    }
    let widest = 2.0 * (0..3).map(|k| high[k] - low[k]).fold(0.0, f64::max);
    let mut side = group.first_side(child_error);
    while side > 0.0 && side <= widest && side * ERROR_PER_SIZE < beat {
        let mut candidates: Vec<Cell> = Vec::new();
        for &t in &group.triangles {
            cells(corners(start + t as usize), side, |c| candidates.push(c));
        }
        candidates.sort_unstable_by_key(|c| (c[2], c[1], c[0]));
        candidates.dedup();
        let voxels = solid(sampled(surface, &candidates, side));
        let packed = bricks(&voxels);
        // No voxel left draws nothing in the triangles' place: a larger side is tried.
        if !voxels.is_empty() && voxels.len() <= budget.0 && packed.len() <= budget.1 {
            return Some(Voxelized {
                primitive: None,
                group: group.group,
                level: group.level,
                triangle_error: group.error,
                forced: false,
                side,
                brick_parents: vec![f64::INFINITY; packed.len()],
                voxels,
                bricks: packed,
            });
        }
        side *= GROWTH;
    }
    None
}

/// Each of `candidates` sampled against the primitive's triangles that overlap it.
fn sampled(surface: &Surface<'_>, candidates: &[Cell], side: f64) -> Vec<Voxel> {
    let bound = |k: usize, pick: fn(i32, i32) -> i32, end: i32| {
        let c = candidates.iter().map(|c| c[k]).reduce(pick).unwrap_or(0);
        f64::from(c + end) * side
    };
    let low: [f64; 3] = std::array::from_fn(|k| bound(k, i32::min, 0));
    let high: [f64; 3] = std::array::from_fn(|k| bound(k, i32::max, 1));
    let near = (surface.range.clone().zip(surface.boxes))
        .filter(|(_, (from, to))| (0..3).all(|k| from[k] <= high[k] && to[k] >= low[k]))
        .map(|(t, _)| t);
    let bins = binned(&surface.probe.mesh.world, (candidates, side), near);
    (candidates.par_iter().zip(&bins))
        .map(|(&cell, ranks)| {
            let joint = surface.joints.and_then(|j| {
                let of = ranks.iter().map(|&r| j[r as usize - surface.range.start]);
                most(of.filter(|&j| j != u16::MAX))
            });
            Voxel::sampled(surface.probe, (cell, side), ranks, joint)
        })
        .collect()
}

/// Per triangle of source mesh `mesh`, the joint its corners weigh most (`u16::MAX` for none),
/// when a primitive of it is skinned.
pub(super) fn mesh_joints(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    traceable: &Traceable,
) -> Result<Option<Vec<u16>>> {
    let mut out: Option<Vec<u16>> = None;
    for (index, range) in &traceable.primitives {
        if let Some(joints) = triangle_joints(inputs, mesh, *index)? {
            let all = out.get_or_insert_with(|| vec![u16::MAX; traceable.world.tags.len()]);
            all[range.clone()].copy_from_slice(&joints);
        }
    }
    Ok(out)
}

/// Per triangle of primitive `index` of `mesh`, the joint its corners weigh most, when it is
/// skinned.
fn triangle_joints(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    index: usize,
) -> Result<Option<Vec<u16>>> {
    let p = &inputs.g["meshes"][mesh]["primitives"][index];
    if p.pointer("/attributes/JOINTS_0").is_none() {
        return Ok(None);
    }
    let (positions, indices, _) = read(inputs.g, inputs.bin, p, None)?;
    let count = positions.count;
    let deformation = page_deformation(inputs.g, inputs.bin, p, count, &BTreeSet::new())?;
    let Some((joints, weights)) = deformation.skin else {
        return Ok(None);
    };
    let per = joints.len() / count.max(1);
    let joint = |t: &[u32]| {
        let mut weighed: BTreeMap<u32, f32> = BTreeMap::new();
        for k in t
            .iter()
            .flat_map(|&v| v as usize * per..(v as usize + 1) * per)
        {
            *weighed.entry(joints[k]).or_default() += weights[k];
        }
        let best = weighed.into_iter().max_by(|a, b| a.1.total_cmp(&b.1));
        best.map_or(u16::MAX, |(j, _)| j.min(u32::from(u16::MAX - 1)) as u16)
    };
    Ok(Some(indices.chunks_exact(3).map(joint).collect()))
}
