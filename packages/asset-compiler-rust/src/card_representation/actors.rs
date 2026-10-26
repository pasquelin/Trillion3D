//! The cards of an HLOD cell's actors: built from the level-0 triangles of the meshes the cell's
//! layer built, in the world's space, read as one mesh — as the cell's distance field is
//! (`distance_field::actors_field`) — and stored for the cell (`Owner::HlodCell`), which the
//! runtime places where the world DAG is.
use super::build::build;
use super::encode::PlacedCards;
use super::CardSettings;
use crate::distance_field::{actors_scene, ActorTriangles, Owner, Placed};
use std::sync::atomic::AtomicBool;

/// The cards of the actors `parts` of HLOD cell `cell`, built as `settings` say, every triangle
/// two-sided when `as_if_two_sided`: none when they ask for none, when no triangle is there to
/// cast on, or once `cancelled` is raised. They are fitted in the box of the cell's distance field
/// `field` where it has one.
pub(crate) fn actors_cards(
    (cell, parts): (usize, &[ActorTriangles<'_>]),
    (settings, as_if_two_sided): (&CardSettings, bool),
    (field, cancelled): (Option<&Placed>, &AtomicBool),
) -> Option<PlacedCards> {
    if !settings.builds() {
        return None;
    }
    let scene = actors_scene(parts, as_if_two_sided, true)?;
    let bounds = field.map_or((scene.low, scene.high), Placed::bounds);
    // A cancelled build gives none: the caller refuses the job as cancelled once it reads the token.
    Some(PlacedCards::new(
        Owner::HlodCell(cell as u32),
        build(&scene, bounds, settings, cancelled)?,
    ))
}
