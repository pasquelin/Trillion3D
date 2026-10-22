//! A mesh voxelized, the children drawn and the far group.
use super::super::rays::RayBank;
use super::super::sample::Probe;
use super::super::seed::{SeedGroup, VoxelSeed};
use super::inherit::{parent_of, Boxes};
use super::surface::{mesh_joints, voxelize, Surface};
use super::{VoxelInputs, Voxelized, Voxelled};
use crate::trace::surface::Traceable;
use crate::trace::tracer::vertex;
use crate::{invalid, Result};
use std::collections::HashMap;
use std::ops::Range;
use trillion3d_math::geometry::aabb::aabb_of;

/// The error each group of a primitive drawn as voxels is drawn at, by its rank.
type Drawn = HashMap<usize, f64>;
/// Per primitive: its rank, its triangles' ranks, and what it draws as voxels.
type Lower = Vec<(usize, Range<usize>, Drawn)>;
/// Per group of a primitive drawn as voxels: its place in the mesh's `Voxelized` list, and the
/// outputs' centres and parents the group above it takes its bricks by.
type Made<'a> = HashMap<usize, (usize, &'a [([f64; 3], usize)])>;

/// The groups of compiled mesh `compiled`, read from source mesh `source`, drawn as voxels: each
/// of its `primitives`' seeded groups in level order, then its far group, above every primitive's
/// roots and sampled against all its triangles, so its voxels mix its materials. Sampled as the
/// source mesh's build says (`VoxelInputs::settings`).
pub(super) fn voxelize_mesh(
    inputs: &VoxelInputs<'_>,
    (compiled, source): (u64, usize),
    primitives: &[usize],
) -> Result<Voxelled> {
    let traceable = Traceable::read(inputs.g, inputs.bin, source, inputs.previews)?;
    let count = traceable.world.tags.len();
    let joints = mesh_joints(inputs, source, &traceable)?;
    let near = vec![0.0; count];
    let settings = inputs.settings[source];
    let bank = RayBank::of(&settings);
    let probe = Probe {
        mesh: &traceable,
        near: &near,
        tie: traceable.tie(),
        settings,
        bank: &bank,
    };
    let corners = |t: usize| [0, 1, 2].map(|k| vertex(&traceable.world, t, k));
    let boxes: Vec<_> = (0..count).map(|t| aabb_of(corners(t))).collect();
    let whole = Surface {
        probe: &probe,
        range: 0..count,
        boxes: &boxes,
        joints: joints.as_deref(),
    };
    let mut groups = Vec::new();
    let mut lower: Lower = Vec::new();
    for &p in primitives {
        let range = primitive_range(inputs, &traceable, p)?;
        let surface = whole.within(range.clone());
        let drawn = primitive_groups(&surface, (p, &inputs.seeds[p]), &mut groups);
        lower.push((p, range, drawn));
    }
    let (far, forced) = far_voxels(inputs, &whole, compiled as usize, (&lower, &groups[..]));
    let far_error = far.as_ref().map(Voxelized::error);
    // Each primitive's roots are replaced by the far group.
    let mut voxels_from = 0.0_f64;
    for (p, _, drawn) in &mut lower {
        let seed = &inputs.seeds[*p];
        voxels_from = voxels_from.max(replaced(seed, (*p, drawn), far_error, &mut groups));
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
        settings,
    })
}

/// The far group of compiled mesh `mesh` sampled against all its triangles (`whole`), and whether
/// a root comes from a voxel group. A far group has no triangles to beat: its side grows until it
/// fits. Its error is never below its roots' — its first side is at least theirs over
/// `ERROR_PER_SIZE` —, and where no side keeps a voxel there is none: the roots are drawn at every
/// distance. Only roots drawn as voxels go on, from their voxels (`groups` those drawn).
fn far_voxels(
    inputs: &VoxelInputs<'_>,
    whole: &Surface<'_>,
    mesh: usize,
    (lower, groups): (&Lower, &[Voxelized]),
) -> (Option<Voxelized>, bool) {
    let (far, inherited) = far_group(inputs, mesh, (lower, groups));
    let child_error = far.children.iter().map(|c| c.1).fold(0.0, f64::max);
    let forced = !inherited.is_empty();
    let far = forced.then(|| voxelize(whole, (&far, &inherited), child_error, f64::INFINITY));
    (far.flatten(), forced)
}

/// The ranks in `traceable` of the triangles of primitive `p`.
fn primitive_range(
    inputs: &VoxelInputs<'_>,
    traceable: &Traceable,
    p: usize,
) -> Result<Range<usize>> {
    let index = inputs.primitives[p]["primitive"].as_u64().unwrap_or(0) as usize;
    (traceable.primitives.iter())
        .find(|(i, _)| *i == index)
        .map(|(_, range)| range.clone())
        .ok_or_else(|| invalid("A voxelized primitive draws no triangles"))
}

/// The groups of primitive `p`, whose triangles are `surface`'s, drawn as voxels, in level order,
/// pushed onto `groups`; the error each is drawn at.
fn primitive_groups(
    surface: &Surface<'_>,
    (p, seed): (usize, &VoxelSeed),
    groups: &mut Vec<Voxelized>,
) -> Drawn {
    let (mut drawn, mut made) = (Drawn::new(), Made::new());
    let ruled = seed.groups.split_last().map_or(&[][..], |(_, r)| r);
    for group in ruled {
        let (forced, child_error) = children_drawn(group, &drawn);
        let inherited = inherited_boxes(group, (&made, &groups[..]));
        // From the build's voxel level up every group is voxels.
        let forced = forced || surface.probe.settings.forces(group.level);
        // Triangles from a voxel group are no alternative to beat.
        let beat = match forced {
            true => f64::INFINITY,
            false => group.error,
        };
        if let Some(voxelized) = voxelize(surface, (group, &inherited), child_error, beat) {
            drawn.insert(group.group, voxelized.error());
            made.insert(group.group, (groups.len(), &group.parents[..]));
            groups.push(Voxelized {
                primitive: Some(p),
                forced,
                ..voxelized
            });
        }
    }
    drawn
}

/// What `group` takes of its children drawn as voxels, by child: the voxels its bricks held of the
/// first child of each voxel group, none of the others (`Boxes`).
fn inherited_boxes(
    group: &SeedGroup,
    (made, groups): (&Made<'_>, &[Voxelized]),
) -> Vec<(usize, Boxes)> {
    let mut gathered: Vec<usize> = Vec::new();
    let mut inherited = Vec::new();
    for (child, &(source, _)) in group.children.iter().enumerate() {
        let Some(&(at, parents)) = source.and_then(|s| made.get(&s)) else {
            continue;
        };
        let first = !gathered.contains(&at);
        gathered.push(at);
        inherited.push((
            child,
            match first {
                true => Boxes::of(&groups[at], parents, group.group),
                false => Boxes::default(),
            },
        ));
    }
    inherited
}

/// Primitive `p`'s roots replaced by the far group, drawn at `far_error` if there is one, and
/// each brick of its groups in `groups` replaced; the largest error its triangle children are
/// replaced at.
fn replaced(
    seed: &VoxelSeed,
    (p, drawn): (usize, &mut Drawn),
    far_error: Option<f64>,
    groups: &mut [Voxelized],
) -> f64 {
    if let (Some(above), Some(error)) = (seed.groups.last(), far_error) {
        drawn.insert(above.group, error);
    }
    // A triangle child is replaced at its group's error, as voxels when its group is; one from a
    // voxel group is never drawn.
    let children = (seed.groups.iter()).flat_map(|group| {
        let at = drawn.get(&group.group).copied().unwrap_or(group.error);
        let triangles =
            (group.children.iter()).filter(|c| c.0.is_none_or(|s| !drawn.contains_key(&s)));
        triangles.map(move |_| at)
    });
    let voxels_from = children.fold(0.0, f64::max);
    // A brick is replaced with the output nearest it, when that output's parent is drawn: at its
    // voxel error, or its triangles' as triangles, or the far group's above the roots.
    let replaced_at = |rank: usize| match seed.errors.get(rank) {
        Some(&error) => drawn.get(&rank).copied().unwrap_or(error),
        None => far_error.unwrap_or(f64::INFINITY),
    };
    for group in groups.iter_mut().filter(|g| g.primitive == Some(p)) {
        let parents = &seed.group(group.group).parents;
        group.brick_parents = (group.bricks.iter())
            .map(|brick| parent_of(brick, group.side, parents).map_or(f64::INFINITY, replaced_at))
            .collect();
    }
    voxels_from
}

/// Whether a child of `group` comes from a group drawn as voxels, and the largest error its
/// children are drawn at, those at their voxel error.
fn children_drawn(group: &SeedGroup, drawn: &Drawn) -> (bool, f64) {
    let voxel = |&(source, _): &(Option<usize>, f64)| source.and_then(|s| drawn.get(&s).copied());
    let forced = group.children.iter().any(|c| voxel(c).is_some());
    let error = (group.children.iter())
        .map(|c| voxel(c).unwrap_or(c.1))
        .fold(0.0, f64::max);
    (forced, error)
}

/// The far group of a mesh, from each primitive's group above its roots: their children, each at
/// the error it is drawn at — a root from a voxel group at that group's —, their area, vertices
/// and triangles, as ranks among the mesh's; and what it takes of the roots drawn as voxels, by
/// child (`inherited_boxes`), the voxels of the groups `groups` holds.
fn far_group(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    (lower, groups): (&Lower, &[Voxelized]),
) -> (SeedGroup, Vec<(usize, Boxes)>) {
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
        child_ends: Vec::new(),
    };
    let mut inherited = Vec::new();
    for (p, range, drawn) in lower {
        let seed = &inputs.seeds[*p];
        let Some(above) = seed.groups.last() else {
            continue;
        };
        far.level = far.level.max(above.level);
        far.area += above.area;
        far.vertices += above.vertices;
        // The primitive's voxel groups, the group above its roots taking their root bricks.
        let made: Made<'_> = (groups.iter().enumerate())
            .filter(|(_, v)| v.primitive == Some(*p))
            .map(|(at, v)| (v.group, (at, &seed.group(v.group).parents[..])))
            .collect();
        let owned = inherited_boxes(above, (&made, groups));
        let error = |&(source, error): &(Option<usize>, f64)| {
            source.and_then(|s| drawn.get(&s).copied()).unwrap_or(error)
        };
        let first = far.children.len();
        inherited.extend(
            owned
                .into_iter()
                .map(|(child, boxes)| (first + child, boxes)),
        );
        for (child, c) in above.children.iter().enumerate() {
            far.children.push((None, error(c)));
            let share = above.child_triangles(child);
            far.triangles
                .extend(share.iter().map(|&t| range.start as u32 + t));
            far.child_ends.push(far.triangles.len());
        }
    }
    (far, inherited)
}
