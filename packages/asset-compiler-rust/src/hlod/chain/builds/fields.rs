//! The distance field and the cards of a cell's actors: the field where their layer allows a distance
//! field (`allowDistanceField`), the cards whenever the job asks for any, with a field or not, as
//! every mesh's are: from the actors' own level-0 triangles — the mesh the
//! layer built, before its DAG simplifies it — in the world's space, at the settings an HLOD mesh
//! is given (`MeshBuildOptions::hlod_distance_field`: the job's switch, density, finest resolution
//! and two-sidedness, the default resolution scale; `MeshBuildOptions::hlod_cards`), as one mesh
//! whatever its sections. They ride the cell's first actor to the distance field and the mesh
//! cards stages (`Actor::field`, `Actor::cards`, `stage_world_roots`), and their time is the
//! step `distanceField`'s.
use super::*;
use super::{Builder, Spent, DISTANCE_FIELD};
use crate::card_representation::{actors_cards, PlacedCards};
use crate::distance_field::{actors_field, field_bytes, scene_bytes, ActorTriangles, Placed};
use crate::hlod::flatten::merge::Section;
use crate::hlod::flatten::timed;
use crate::plugins::scene::cancel;
use crate::HlodLayer;

/// A cell's field and cards.
pub(super) type Representations = (Option<Placed>, Option<PlacedCards>);

/// The field — when `field_allowed`, the layer's — and the cards of the actors `parts` of cell
/// `cell`, as the scene's settings say, their milliseconds added to `spent`. The cards are fitted in
/// the box of the field, where there is one.
fn built(
    cell: usize,
    parts: &[ActorTriangles<'_>],
    field_allowed: bool,
    (builder, spent): (&Builder, &mut Spent),
) -> Result<Representations> {
    let mesh_build = builder.o.mesh_build()?;
    let (settings, cards) = (mesh_build.hlod_distance_field(), mesh_build.hlod_cards());
    let made = timed(&mut spent.ms[DISTANCE_FIELD], || {
        let field = if field_allowed {
            actors_field(cell, parts, &settings)
        } else {
            None
        };
        let cards = actors_cards(
            (cell, parts),
            (&cards, settings.as_if_two_sided),
            (field.as_ref(), &builder.o.cancelled),
        );
        (field, cards)
    });
    // A build the token stopped holds partial cards: the job is refused, never written with them.
    cancel::check(&builder.o.cancelled)?;
    Ok(made)
}

/// The field and the cards of the one mesh `positions`, `indices` that cell `cell` of layer `hlod`
/// makes, wearing a material that draws both faces or not: no field when the layer does not allow a
/// distance field, the cards all the same.
pub(super) fn mesh_fields(
    (cell, hlod): (usize, &HlodLayer),
    (positions, indices, two_sided): (&[f32], &[u32], bool),
    context: (&Builder, &mut Spent),
) -> Result<Representations> {
    let part = ActorTriangles {
        positions,
        indices,
        two_sided,
        blended: false,
    };
    built(cell, &[part], hlod.allow_distance_field, context)
}

/// The field and the cards of the `sections` that cell `cell` of layer `hlod` makes, each wearing
/// its material of the scene — drawing both faces or not, a blended one left out of the field, not
/// of the cards —: no field when the layer does not allow a distance field, the cards all the same.
pub(super) fn sections_fields(
    (cell, hlod): (usize, &HlodLayer),
    sections: &[Section],
    context: (&Builder, &mut Spent),
) -> Result<Representations> {
    let library = context.0.library;
    let parts: Vec<ActorTriangles<'_>> = (sections.iter())
        .map(|(material, geometry)| ActorTriangles {
            positions: &geometry.0,
            indices: &geometry.2,
            two_sided: library.double_sided(*material),
            blended: library.surface(*material).blend,
        })
        .collect();
    built(cell, &parts, hlod.allow_distance_field, context)
}

/// The bytes the field and the cards of the actors of the cell whose original objects are `members`
/// hold while they are built, beside what the actors hold: the field's where the layer `hlod`
/// allows one and the job builds one, the cards' scene where the job asks for cards — a field and
/// cards are built one after the other, so the greater of the two. At most the cell's triangles'
/// worth, whatever the actors approximate them by.
pub(super) fn working_bytes(
    instances: &[Instance],
    hlod: &HlodLayer,
    members: &[usize],
    builder: &Builder,
) -> usize {
    let Ok(mesh_build) = builder.o.mesh_build() else {
        return 0;
    };
    let triangles = super::super::place::triangles(instances, members);
    let field = if hlod.allow_distance_field {
        field_bytes(triangles, &mesh_build.hlod_distance_field())
    } else {
        0
    };
    let cards = if mesh_build.hlod_cards().builds() {
        scene_bytes(triangles)
    } else {
        0
    };
    field.max(cards)
}
