//! What the ray tracer reads of the world DAG (`ray_tracing/world.rs`): per cluster, its actor, the
//! HLOD cell whose switch shows that actor and the flags of the material the actor wears, and the
//! world's trees built over them. They lie on the positions the pages decode to, what the raster
//! draws.
use super::builds::{Actor, Wears};
use super::merge::WorldDag;
use crate::compiler::primitive::drawn_blended;
use crate::hlod::flatten::bake::publish::{coverage_of, wear_coverage};
use crate::ray_tracing::{material_flags, world_trees, WorldGate, WorldTrees};
use crate::Result;
use serde_json::{json, Value};

/// The flags of the material `wears` puts on an actor, as any primitive wearing it: a flattened
/// material is the one published (`publish::flattened_material`), its alpha as its atlas's base image
/// says (`wear_coverage`) and both faces drawn when the atlas does; a material of the scene,
/// `materials`.
pub(super) fn flags_of(wears: &Wears, materials: &[Value]) -> u32 {
    let mut flattened;
    let material = match wears {
        Wears::Flattened {
            images,
            double_sided,
        } => {
            flattened = json!({ "doubleSided": double_sided });
            wear_coverage(&mut flattened, coverage_of(images));
            Some(&flattened)
        }
        Wears::Merged(rank) => rank.and_then(|rank| materials.get(rank as usize)),
    };
    material_flags(material, drawn_blended(material))
}

/// The world's trees for ray tracing over `world`, whose actors `actors` wear materials of the
/// published scene `materials`; none when no actor holds a triangle, an error when a tree is too
/// large. A voxel actor's clusters hold a box's corners, no surface (`WorldDag::voxels`): they are
/// left out.
pub(super) fn ray_tracing(
    world: &WorldDag,
    actors: &[Actor],
    materials: &[Value],
) -> Result<Option<WorldTrees>> {
    let flags: Vec<u32> = (actors.iter())
        .map(|actor| flags_of(&actor.wears, materials))
        .collect();
    let gates: Vec<Option<WorldGate>> = (0..world.clusters.len())
        .map(|slot| {
            let actor = world.actors[slot];
            world.voxels[slot].is_none().then(|| WorldGate {
                actor,
                cell: world.hlod(slot),
                flags: flags[actor],
            })
        })
        .collect();
    world_trees(&world.decoded, &world.clusters, &gates)
}
