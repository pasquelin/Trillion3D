//! A mesh voxelized, the children drawn and the far group.
use super::super::sample::Probe;
use super::super::seed::SeedGroup;
use super::surface::{mesh_joints, voxelize, Surface};
use super::{VoxelInputs, Voxelized, Voxelled};
use crate::proxy::tracer::vertex;
use crate::surface_trace::Traceable;
use crate::{invalid, Result};
use std::collections::HashMap;
use std::ops::Range;
use trillion3d_math::aabb::aabb_of;
use trillion3d_math::vecn::sub;

/// The groups of compiled mesh `compiled`, read from source mesh `source`, drawn as voxels: each
/// of its `primitives`' seeded groups in level order, then its far group, above every primitive's
/// roots and sampled against all its triangles, so its voxels mix its materials.
pub(super) fn voxelize_mesh(
    inputs: &VoxelInputs<'_>,
    (compiled, source): (u64, usize),
    primitives: &[usize],
) -> Result<Voxelled> {
    let traceable = Traceable::read(inputs.g, inputs.bin, source, inputs.previews)?;
    let count = traceable.world.tags.len();
    let joints = mesh_joints(inputs, source, &traceable)?;
    let near = vec![0.0; count];
    let probe = Probe {
        mesh: &traceable,
        near: &near,
        tie: traceable.tie(),
    };
    let boxes: Vec<([f64; 3], [f64; 3])> = (0..count)
        .map(|t| aabb_of([0, 1, 2].map(|k| vertex(&traceable.world, t, k))))
        .collect();
    let whole = Surface {
        probe: &probe,
        range: 0..count,
        boxes: &boxes,
        joints: joints.as_deref(),
    };
    let mut groups = Vec::new();
    // Per primitive: its triangles' ranks, and the error each of its groups drawn as voxels is
    // drawn at.
    let mut lower: Vec<(usize, Range<usize>, HashMap<usize, f64>)> = Vec::new();
    for &p in primitives {
        let index = inputs.primitives[p]["primitive"].as_u64().unwrap_or(0) as usize;
        let range = (traceable.primitives.iter())
            .find(|(i, _)| *i == index)
            .map(|(_, range)| range.clone())
            .ok_or_else(|| invalid("A voxelized primitive draws no triangles"))?;
        let surface = whole.within(range.clone());
        let mut drawn: HashMap<usize, f64> = HashMap::new();
        let ruled = inputs.seeds[p]
            .groups
            .split_last()
            .map_or(&[][..], |(_, r)| r);
        for group in ruled {
            let (forced, child_error) = children_drawn(group, &drawn);
            // Triangles from a voxel group are no alternative to beat.
            let beat = match forced {
                true => f64::INFINITY,
                false => group.error,
            };
            if let Some(voxelized) = voxelize(&surface, group, child_error, beat) {
                drawn.insert(group.group, voxelized.error());
                groups.push(Voxelized {
                    primitive: Some(p),
                    forced,
                    ..voxelized
                });
            }
        }
        lower.push((p, range, drawn));
    }
    let (far, forced) = far_group(inputs, compiled as usize, &lower);
    let child_error = far.children.iter().map(|c| c.1).fold(0.0, f64::max);
    // A far group has no triangles to beat: its side grows until it fits. Its error is never
    // below its roots' — its first side is at least theirs over `ERROR_PER_SIZE` —, and where no
    // side keeps a voxel there is none: the roots are drawn at every distance. Only roots drawn
    // as voxels go on.
    let far = forced
        .then(|| voxelize(&whole, &far, child_error, f64::INFINITY))
        .flatten();
    let far_error = far.as_ref().map_or(f64::INFINITY, Voxelized::error);
    // Each primitive's roots are replaced by the far group.
    let mut voxels_from = 0.0_f64;
    for (p, _, drawn) in &mut lower {
        let seed = &inputs.seeds[*p];
        if let Some(above) = seed.groups.last().filter(|_| far.is_some()) {
            drawn.insert(above.group, far_error);
        }
        // A triangle child is replaced at its group's error, as voxels when its group is; one
        // from a voxel group is never drawn.
        let replaced = (seed.groups.iter()).flat_map(|group| {
            let at = drawn.get(&group.group).copied().unwrap_or(group.error);
            let triangles =
                (group.children.iter()).filter(|c| c.0.is_none_or(|s| !drawn.contains_key(&s)));
            triangles.map(move |_| at)
        });
        voxels_from = voxels_from.max(replaced.fold(0.0, f64::max));
        // A brick is replaced with the output nearest it, when that output's parent is drawn:
        // at its voxel error, or its triangles' as triangles, or the far group's above the roots.
        let replaced_at = |rank: usize| match seed.errors.get(rank) {
            Some(&error) => drawn.get(&rank).copied().unwrap_or(error),
            None => far_error,
        };
        for group in groups.iter_mut().filter(|g| g.primitive == Some(*p)) {
            let seeded = seed.groups.iter().find(|s| s.group == group.group);
            let parents = &seeded.expect("a voxel group is seeded").parents;
            let side = group.side;
            group.brick_parents = (group.bricks.iter())
                .map(|brick| {
                    let centre = brick.at.map(|c| (f64::from(c) * 4.0 + 2.0) * side);
                    let distance = |at: [f64; 3]| {
                        let d = sub(at, centre);
                        d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
                    };
                    let nearest =
                        (parents.iter()).min_by(|a, b| distance(a.0).total_cmp(&distance(b.0)));
                    nearest.map_or(f64::INFINITY, |&(_, rank)| replaced_at(rank))
                })
                .collect();
        }
    }
    if let Some(far) = far {
        groups.push(Voxelized {
            primitive: None,
            forced,
            ..far
        });
    }
    Ok(Voxelled {
        mesh: compiled as usize,
        groups: groups.into_iter().flat_map(Voxelized::parts).collect(),
        voxels_from,
    })
}

/// Whether a child of `group` comes from a group drawn as voxels, and the largest error its
/// children are drawn at, those at their voxel error.
fn children_drawn(group: &SeedGroup, drawn: &HashMap<usize, f64>) -> (bool, f64) {
    let voxel = |&(source, _): &(Option<usize>, f64)| source.and_then(|s| drawn.get(&s).copied());
    let forced = group.children.iter().any(|c| voxel(c).is_some());
    let error = (group.children.iter())
        .map(|c| voxel(c).unwrap_or(c.1))
        .fold(0.0, f64::max);
    (forced, error)
}

/// The far group of a mesh, from each primitive's group above its roots: their children, each at
/// the error it is drawn at — a root from a voxel group at that group's —, their area, vertices
/// and triangles, as ranks among the mesh's; and whether a root comes from a voxel group.
fn far_group(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    lower: &[(usize, Range<usize>, HashMap<usize, f64>)],
) -> (SeedGroup, bool) {
    let mut far = SeedGroup {
        group: mesh,
        level: 0,
        error: f64::INFINITY,
        children: Vec::new(),
        parents: Vec::new(),
        area: 0.0,
        vertices: 0,
        num_parents: 1,
        triangles: Vec::new(),
    };
    let mut forced = false;
    for (p, range, drawn) in lower {
        let Some(above) = inputs.seeds[*p].groups.last() else {
            continue;
        };
        far.level = far.level.max(above.level);
        far.area += above.area;
        far.vertices += above.vertices;
        let (voxel, _) = children_drawn(above, drawn);
        forced |= voxel;
        let error = |&(source, error): &(Option<usize>, f64)| {
            source.and_then(|s| drawn.get(&s).copied()).unwrap_or(error)
        };
        far.children
            .extend(above.children.iter().map(|c| (None, error(c))));
        far.triangles
            .extend(above.triangles.iter().map(|&t| range.start as u32 + t));
    }
    (far, forced)
}
