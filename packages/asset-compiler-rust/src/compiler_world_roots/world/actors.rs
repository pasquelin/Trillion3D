//! What children wear, and the flattened, approximated and merged actors with their bytes.
use super::super::flatten::{self, step, Recipe, Shell};
use super::super::place::gather;
use super::measures::traced;
use super::*;
use super::{
    actor, actor_by, build, lock, min_visible, Actor, Builder, Job, Spent, Wears, DAG, MERGE,
};
use crate::compiler_budget::admission::Done;
use crate::{HlodBuilder, HlodLayer};
use flatten::mesh_merge::{self, Material};
use std::sync::Mutex;

/// The id of each actor whose flattened material one of `children` wears: the child itself, or
/// the actor it wears.
fn worn<'a>(children: &'a [(usize, &'a Actor)]) -> impl Iterator<Item = usize> + 'a {
    (children.iter()).filter_map(|&(id, actor)| match actor.material(id) {
        Material::Actor(worn) => Some(worn),
        Material::Source(_) => None,
    })
}

/// The side of each atlas one of `children` wears that is still kept (`worn`).
pub(super) fn worn_sizes(children: &[(usize, &Actor)], done: &Done<Job>) -> Vec<usize> {
    let mut ids: Vec<usize> = worn(children).collect();
    ids.sort_unstable();
    ids.dedup();
    (ids.into_iter())
        .filter_map(|id| {
            lock(&actor_by(done, id).atlas)
                .as_ref()
                .map(|atlas| atlas.size)
        })
        .collect()
}

/// The atlas of each actor one of `children` wears (`worn`), by its id, taken from it: read by a
/// job that merges its materials, its last reader — that job's actor wears its own flattened
/// material, so no layer above reads the atlases under it again.
pub(super) fn take_worn(
    children: &[(usize, &Actor)],
    done: &Done<Job>,
) -> BTreeMap<usize, flatten::Atlas> {
    let mut atlases = BTreeMap::new();
    for id in worn(children) {
        if !atlases.contains_key(&id) {
            if let Some(atlas) = lock(&actor_by(done, id).atlas).take() {
                atlases.insert(id, atlas);
            }
        }
    }
    atlases
}

/// Whether the layer `above` reads remeshes the actors under it into a shell: it then reads their
/// closed meshes (`flatten::Placed`).
fn remeshes(above: Option<HlodBuilder>) -> bool {
    above.is_some_and(|b| matches!(Recipe::of(b), Recipe::Shell(_)))
}

/// The actor of cell `cell` wearing its own flattened material that `made` holds, its atlas kept
/// when the layer above merges (`above`), and its closed mesh when the layer above remeshes;
/// `Err` with the reason it could not be made.
fn flattened_actor(
    cell: usize,
    made: flatten::Built,
    above: Option<HlodBuilder>,
    (builder, mut spent): (&Builder, Spent),
) -> Result<(Job, Vec<flatten::Placed>)> {
    let made = match made {
        Ok(made) => made,
        Err((reason, stages)) => {
            spent.stages = stages;
            return Ok((
                Job {
                    made: Err(reason),
                    spent,
                },
                Vec::new(),
            ));
        }
    };
    (builder.checkpoint)()?;
    spent.stages = made.stages;
    spent.ms[..step::COUNT]
        .iter_mut()
        .zip(made.stage_ms)
        .for_each(|(total, ms)| *total += ms);
    let closed = if remeshes(above) {
        vec![made.closed]
    } else {
        Vec::new()
    };
    let keep = above == Some(HlodBuilder::Merge);
    let actor = actor(cell, (made.flat, made.atlas), keep, (builder, &mut spent))?;
    Ok((
        Job {
            made: Ok(vec![actor]),
            spent,
        },
        closed,
    ))
}

/// The actor `shell` — layer `hlod` — makes of cell `cell` of the level below at HLOD `level`: the
/// shell of the cell's objects at HLOD 1, above it of the closed meshes `below` of the actors
/// under it — each layer simplifies the one below rather than the full sources —, the materials of
/// `members`, the instances under it, read onto it: above HLOD 1 only those the level may show
/// (`traced`). `above` is the builder of the layer that reads it.
pub(super) fn approximated_actor(
    instances: &[Instance],
    (level, cell): (usize, usize),
    (shell, hlod, above): (Shell, &HlodLayer, Option<HlodBuilder>),
    (members, below): (&[usize], &[flatten::Placed]),
    builder: &Builder,
) -> Result<(Job, Vec<flatten::Placed>)> {
    let object = |i: usize| (instances[i].material, gather(&instances[i]));
    // At HLOD 1 the objects placed once are the shell's input and the bake's sources; above it the
    // shell closes the meshes below, and the objects are placed once it stands, dropped once
    // traced.
    let objects: Option<Vec<flatten::Object>> =
        (level == 1).then(|| members.iter().map(|&i| object(i)).collect());
    let meshes: Vec<flatten::Mesh> = match &objects {
        Some(objects) => (objects.iter())
            .map(|(_, (positions, _, indices))| (&positions[..], &indices[..]))
            .collect(),
        None => (below.iter())
            .map(|(positions, indices)| (&positions[..], &indices[..]))
            .collect(),
    };
    if meshes.is_empty() {
        let job = Job {
            made: Err("no mesh under the shell"),
            spent: Spent::default(),
        };
        return Ok((job, Vec::new()));
    }
    let sources = || match &objects {
        Some(objects) => std::borrow::Cow::Borrowed(&objects[..]),
        None => std::borrow::Cow::Owned(
            (members.iter())
                .filter(|&&i| traced(&instances[i], level))
                .map(|&i| object(i))
                .collect(),
        ),
    };
    let made = flatten::built(
        (shell, hlod),
        &meshes,
        (sources, builder.library),
        min_visible(level),
    );
    flattened_actor(cell, made, above, (builder, Spent::default()))
}

/// Merged layer `hlod`'s actors of cell `cell` of the level below at HLOD `level`
/// (`flatten::mesh_merge`): at HLOD 1 the objects `members` at the LOD the layer selects, above it
/// the child actors `children`, each by its id (`actor_id`), at LOD 0 wearing what they wear,
/// merged, nothing more. One actor per section, each wearing its material, the first holding the
/// merged mesh when the layer above remeshes (`above`); its materials merged (`mergeMaterials`),
/// one actor wearing its own flattened material, each section's baked into its charts
/// (`mesh_merge::merged_flat`), a child's read from the atlas of the actor that wears it
/// (`atlases`, by id, `take_worn`).
pub(super) fn merged_actors(
    instances: &[Instance],
    (level, cell): (usize, usize),
    (hlod, above): (&HlodLayer, Option<HlodBuilder>),
    (members, children, atlases): (
        &[usize],
        &[(usize, &Actor)],
        BTreeMap<usize, flatten::Atlas>,
    ),
    builder: &Builder,
) -> Result<(Job, Vec<flatten::Placed>)> {
    let mut spent = Spent::default();
    let started = std::time::Instant::now();
    let flattened = hlod.merge_materials;
    let sections = if level == 1 {
        mesh_merge::merged(instances, members, (hlod.lod_selection, flattened))
    } else {
        let pieces = (children.iter())
            .map(|&(id, actor)| (actor.material(id), actor.geometry()))
            .collect();
        mesh_merge::merged_children(pieces, flattened)
    };
    spent.ms[MERGE] = flatten::millis(started);
    let triangles: usize = sections.iter().map(|(_, (_, _, i))| i.len() / 3).sum();
    spent.stages = [triangles; flatten::STAGE_COUNT];
    if triangles == 0 {
        let job = Job {
            made: Err("the merged mesh has no triangle"),
            spent,
        };
        return Ok((job, Vec::new()));
    }
    (builder.checkpoint)()?;
    if flattened {
        let library = (builder.library, &atlases);
        let made = mesh_merge::merged_flat(&sections, library, hlod.texture_size);
        drop((sections, atlases));
        return flattened_actor(cell, made, above, (builder, spent));
    }
    let closed = if remeshes(above) {
        vec![mesh_merge::closed(&sections)]
    } else {
        Vec::new()
    };
    let mut made = Vec::with_capacity(sections.len());
    for (material, geometry) in sections {
        let triangles = geometry.2.len() / 3;
        let started = std::time::Instant::now();
        let built = build(geometry, builder)?;
        spent.ms[DAG] += flatten::millis(started);
        made.push(Actor {
            cell,
            built,
            wears: Wears::Merged(material),
            atlas: Mutex::new(None),
            triangles,
            voxels: Vec::new(),
            levels: None,
        });
    }
    let job = Job {
        made: Ok(made),
        spent,
    };
    Ok((job, closed))
}

/// The bytes merged layer `hlod`'s actors of HLOD `level` hold while they are made
/// (`mesh_merge::working_bytes`): the cuts of the objects `members` at HLOD 1, above it the child
/// actors' meshes at LOD 0 (`children`, by id), when their materials are merged their atlas cooked
/// for `families` block families and the surface of each atlas a section may wear (`atlases`, their
/// sides, `sources::atlas_surface_bytes`).
pub(super) fn merged_bytes(
    instances: &[Instance],
    (level, hlod, families): (usize, &HlodLayer, usize),
    (members, children, atlases): (&[usize], &[(usize, &Actor)], &[usize]),
) -> usize {
    let pieces = if level == 1 {
        mesh_merge::cut_bytes(instances, members, hlod.lod_selection)
    } else {
        (children.iter()).fold((0, 0), |(bytes, corners), &(_, actor)| {
            let ((clusters, _), positions, _) = &actor.built;
            let level0: usize = (clusters.iter().filter(|c| c.level == 0))
                .map(|c| c.indices.len())
                .sum();
            let held = mesh_merge::mesh_bytes(positions.len() / 3, level0);
            (bytes + held, corners + level0)
        })
    };
    if !hlod.merge_materials {
        return mesh_merge::working_bytes(pieces, None);
    }
    // Each atlas a section may wear, read as a surface.
    let surfaces: usize = (atlases.iter())
        .map(|&size| flatten::sources::atlas_surface_bytes(size))
        .sum();
    mesh_merge::working_bytes(pieces, Some((hlod.texture_size, families))).saturating_add(surfaces)
}
