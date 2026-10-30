//! The flattened, approximated, simplified and merged actors, each made of its cell's original
//! objects, with their bytes.
use super::super::place::{objects, triangles};
use super::*;
use super::{actor, all_sky, build, Actor, Builder, Job, Spent, Wears, DAG, MERGE};
use crate::hlod::flatten::{merge, step, timed, Placements, Sides, SourceMesh};
use crate::hlod::options::{HlodMapSides, MERGE_FLOORS};
use crate::HlodLayer;
use std::collections::{BTreeMap, BTreeSet};

/// The actor of cell `cell` of layer `hlod` wearing its own flattened material that `made` holds,
/// its mesh given a cluster DAG when the layer asks for one (`clusterDag`); `Err` with the reason
/// it could not be made.
fn flattened_actor(
    (hlod, cell, sky): (&HlodLayer, usize, bool),
    made: crate::hlod::flatten::Built,
    (builder, mut spent): (&Builder, Spent),
) -> Result<Job> {
    let made = match made {
        Ok(made) => made,
        Err((reason, stages)) => {
            spent.stages = stages;
            return Ok(Job {
                made: Err(reason),
                spent,
            });
        }
    };
    (builder.checkpoint)()?;
    spent.stages = made.stages;
    spent.ms[..step::COUNT]
        .iter_mut()
        .zip(made.stage_ms)
        .for_each(|(total, ms)| *total += ms);
    let flat = (made.flat, made.atlas);
    let actor = actor((cell, hlod, sky), flat, (builder, &mut spent))?;
    Ok(Job {
        made: Ok(vec![actor]),
        spent,
    })
}

/// The objects `members` of `instances` as an approximation's shell reads them
/// (`flatten::Placements`): each node one object, its mesh its primitives' level 0 end to end in
/// their order, in its own space, held once however many nodes place it; a node whose primitives
/// hold no triangle left out.
fn placements(instances: &[Instance], members: &[usize]) -> Placements {
    let mut by_node: BTreeMap<usize, Vec<&Instance>> = BTreeMap::new();
    for &i in members {
        by_node
            .entry(instances[i].node)
            .or_default()
            .push(&instances[i]);
    }
    let (mut meshes, mut placed) = (Vec::new(), Vec::new());
    // Each mesh's rank by the covers its primitives place, in order.
    let mut ranks: BTreeMap<Vec<usize>, usize> = BTreeMap::new();
    for primitives in by_node.into_values() {
        if primitives.iter().all(|p| p.cover.indices.is_empty()) {
            continue;
        }
        let key = (primitives.iter()).map(|p| p.source()).collect();
        let rank = *ranks.entry(key).or_insert_with(|| {
            let (mut positions, mut indices) = (Vec::new(), Vec::new());
            for p in &primitives {
                let base = (positions.len() / 3) as u32;
                positions.extend_from_slice(&p.cover.positions);
                indices.extend(p.cover.indices.iter().map(|&v| v + base));
            }
            meshes.push(SourceMesh { positions, indices });
            meshes.len() - 1
        });
        placed.push((rank, primitives[0].matrix));
    }
    Placements { meshes, placed }
}

/// The actor approximated layer `hlod` makes of cell `cell`, first drawn `seen` metres away,
/// whatever its level, from its cell's original objects `members` — every object under it, never
/// an actor below —: its shell made of their meshes, each once in its own space, as they place
/// them (`placements`), its bake reading them placed in world space, each in its material, let go
/// once traced, its atlas sized as the layer says (`seen` the distance a `drawDistance` sizing
/// reads, `flatten::approximated`).
pub(super) fn approximated_actor(
    instances: &[Instance],
    (seen, cell): (f64, usize),
    hlod: &HlodLayer,
    members: &[usize],
    builder: &Builder,
) -> Result<Job> {
    let scene = (placements(instances, members), objects(instances, members));
    let made = crate::hlod::flatten::approximated(hlod, scene, (builder.library, seen))?;
    let sky = all_sky(builder.sky, instances, members);
    flattened_actor((hlod, cell, sky), made, (builder, Spent::default()))
}

/// The actor simplified layer `hlod` makes of cell `cell`, first drawn `seen` metres away, from
/// its cell's original objects `members` — every object under it, never an actor below —:
/// remeshed through their volume, simplified for that distance and wearing their materials
/// transferred onto its atlas (`flatten::simplified`); its mesh given a cluster DAG when the layer
/// asks for one (`clusterDag`).
pub(super) fn simplified_actor(
    instances: &[Instance],
    (seen, cell): (f64, usize),
    hlod: &HlodLayer,
    members: &[usize],
    builder: &Builder,
) -> Result<Job> {
    let made = crate::hlod::flatten::simplified(hlod, (instances, members), seen, builder.library)?;
    let sky = all_sky(builder.sky, instances, members);
    flattened_actor((hlod, cell, sky), made, (builder, Spent::default()))
}

/// The bytes simplified layer `hlod`'s actor holds while it is made from the objects `members`
/// (`flatten::simplified_bytes`), its atlas cooked for `families` block families — its side the
/// layer's, or, sized automatically, the largest it may reach: that side is known once the
/// simplified mesh is.
pub(super) fn simplified_bytes(
    instances: &[Instance],
    (hlod, families): (&HlodLayer, usize),
    members: &[usize],
) -> usize {
    let maps = hlod.simplifying.maps;
    let largest = |sizes: &HlodMapSides| Sides::of_baked(sizes, maps).0;
    let side = (hlod.simplifying.sizing).baked_side(hlod.texture_size, largest);
    crate::hlod::flatten::simplified_bytes(triangles(instances, members), side, families)
}

/// The instances of the cell's layer and the ranks among them of the cell's original objects.
type MergeSource<'a, 'b> = (&'a [Instance<'b>], &'a [usize]);

/// The actor of cell `cell` of the merged layer `hlod` wearing its own flattened material, its
/// materials merged: the cut `parts` of the cell's original objects `members`, an atlas sized as
/// the layer says (`merge::atlas_sides`, `seen` the distance a `drawDistance` sizing reads), each of
/// the materials baked into its own cell (`merge::merged_flat`).
fn flat_merge(
    parts: Vec<merge::Part>,
    (source, (seen, cell)): (MergeSource<'_, '_>, (f64, usize)),
    (hlod, builder, spent): (&HlodLayer, &Builder, Spent),
) -> Result<Job> {
    let (instances, members) = source;
    let merging = &hlod.merging;
    let placed = (members.iter()).map(|&i| (instances[i].cover.lods.bounds, &instances[i].matrix));
    let (area, radius) = (merge::area(&parts), merge::sphere(placed).1);
    // Its texels a metre per texel of side, if its coordinates filled the square.
    let reach = || (1.0 / area.sqrt(), radius, seen);
    let own = |sizes: &HlodMapSides| Sides::of_baked(sizes, merging.maps);
    let sizing = (merging.sizing, hlod.texture_size);
    let (side, sides) = merge::atlas_sides(sizing, reach, (MERGE_FLOORS, own));
    let flattening = merge::Flattening {
        side,
        sides,
        gutter: merging.gutter,
        binned: merging.binned,
        on_mesh: merging.on_mesh,
        lightmaps: (merging.reuse_lightmap_uvs, merging.uv_method),
        double_sided: merging.double_sided,
        maps: merging.maps,
    };
    let made = merge::merged_flat(&parts, (builder.library, builder.checkpoint), &flattening)?;
    drop(parts);
    let sky = all_sky(builder.sky, instances, members);
    flattened_actor((hlod, cell, sky), Ok(made), (builder, spent))
}

/// Merged layer `hlod`'s actors of cell `cell`, first drawn `seen` metres away
/// (`flatten::merge`): its cell's original objects `members` — every object under it, never an
/// actor below —, each at the LOD the layer selects (`lodSelection`, `lodScreenSize`), its
/// equivalent materials collapsed when the layer asks it (`collapseEquivalentMaterials`), merged,
/// nothing more. One actor per section, each wearing its material of the scene; its materials
/// merged (`mergeMaterials`), one actor wearing its own flattened material, its atlas sized as
/// the layer says (`merge::atlas_sides`, `seen` the distance a `drawDistance` sizing reads) and
/// each of its materials baked into its own cell (`merge::merged_flat`). Each actor's mesh is
/// given a cluster DAG when the layer asks for one (`clusterDag`). A merged mesh keeping its
/// materials keeps its sources' vertex colours when the layer asks (`bakeVertexColors`,
/// `merge::sections`).
pub(super) fn merged_actors(
    instances: &[Instance],
    (seen, cell): (f64, usize),
    hlod: &HlodLayer,
    members: &[usize],
    builder: &Builder,
) -> Result<Job> {
    let mut spent = Spent::default();
    let merging = &hlod.merging;
    let cut = (hlod.lod_selection, merging.lod_screen_size);
    let classes = merging.collapse.then_some(builder.classes);
    let parts = timed(&mut spent.ms[MERGE], || {
        merge::merged(instances, members, (cut, classes))
    });
    let triangles: usize = parts.iter().map(|p| p.geometry.2.len() / 3).sum();
    spent.stages = [triangles; crate::hlod::flatten::STAGE_COUNT];
    if triangles == 0 {
        return Ok(Job {
            made: Err("the merged mesh has no triangle"),
            spent,
        });
    }
    (builder.checkpoint)()?;
    if hlod.merge_materials {
        let cell_of = ((instances, members), (seen, cell));
        return flat_merge(parts, cell_of, (hlod, builder, spent));
    }
    let sections = merge::sections(parts, merging.keep_colours);
    // The field and the cards of the cell's sections together, on the first actor.
    let (mut field, mut cards) =
        fields::sections_fields((cell, hlod), &sections, (builder, &mut spent))?;
    let mut made = Vec::with_capacity(sections.len());
    for (material, geometry) in sections {
        let triangles = geometry.2.len() / 3;
        let shaping = (builder, hlod.cluster_dag, &hlod.mesh_build.shaping);
        let built = timed(&mut spent.ms[DAG], || build(geometry, shaping))?;
        made.push(Actor {
            cell,
            built,
            wears: Wears::Merged(material),
            triangles,
            voxels: Vec::new(),
            field: field.take(),
            cards: cards.take(),
        });
    }
    Ok(Job {
        made: Ok(made),
        spent,
    })
}

/// The bytes merged layer `hlod`'s actors hold while they are made (`merge::working_bytes`): the
/// cuts the layer takes of the objects `members`, and when their materials are merged their atlas
/// cooked for `families` block families — its side the layer's, or, sized automatically, the
/// largest it may reach: that side is known once the merged mesh is —, a translucent material
/// among them of `library` read over what lies behind it where the layer sees through
/// (`Maps::seen_through`).
pub(super) fn merged_bytes(
    instances: &[Instance],
    (hlod, families, library): (&HlodLayer, usize, &Library),
    members: &[usize],
) -> usize {
    let cut = (hlod.lod_selection, hlod.merging.lod_screen_size);
    let pieces = merge::cut_counts(instances, members, Some(cut));
    let maps = hlod.merging.maps;
    let largest = |sizes: &HlodMapSides| Sides::of_baked(sizes, maps).0;
    let side = hlod.merging.sizing.baked_side(hlod.texture_size, largest);
    let flattened = hlod.merge_materials.then(|| {
        let materials: BTreeSet<Option<u64>> =
            members.iter().map(|&i| instances[i].material).collect();
        let behind = (materials.into_iter()).any(|m| merge::seen_through(m, library, maps));
        merge::Flattened {
            side,
            families,
            maps,
            behind,
        }
    });
    merge::working_bytes(pieces, flattened)
}
