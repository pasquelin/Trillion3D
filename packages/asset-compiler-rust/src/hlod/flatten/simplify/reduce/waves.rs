//! The parallel reduction: waves of slabs, then the whole mesh. The floor is `retained` of the
//! source's polygons rounded up, read as a share of the mesh's own triangles; nothing is done
//! when the mesh would keep all of them, or has at most one triangle, or nothing is to go.
//!
//! A wave runs for each slab count of `WAVES` the mesh holds `TRIANGLES_PER_SLAB` triangles a slab
//! for. Every wave and the last pass keep the same share — its power over their number is the
//! floor's share —, a slab keeping that share of its own triangles rounded up, so a slab of few
//! triangles gives up fewer; every slab stops past the same cost. A wave cuts the mesh into slabs
//! (`split`), simplifies each slab on its own thread with the edges on its cuts locked and their
//! vertices listed, and welds the slabs back on those vertices (`weld`); the last pass simplifies
//! the whole mesh, nothing locked, down to the floor.
use super::collapser::simplify;
use super::rounding::ceil_i32;
use super::split::{split, weld};
use super::{Reference, Soup, Stop};
use rayon::prelude::*;

/// The slab counts of the waves in order: primes, so no two waves cut in the same places.
const WAVES: [usize; 2] = [31, 7];
/// The triangles a wave needs per slab to run.
const TRIANGLES_PER_SLAB: usize = 10_000;

/// `mesh` reduced in waves to `retained` of `reference`'s polygons, no collapse past `max_cost`.
pub(super) fn reduce_in_waves(
    mesh: &mut Soup,
    reference: &Reference,
    retained: f32,
    max_cost: f32,
) {
    if retained >= 1.0 || mesh.indices.len() <= 3 {
        return;
    }
    let triangles = mesh.indices.len() / 3;
    let floor = ceil_i32(reference.polygons as f32 * retained);
    let share = floor as f32 / triangles as f32;
    if share >= 1.0 {
        return;
    }
    let waves: Vec<usize> = (WAVES.into_iter())
        .filter(|&slabs| triangles >= slabs * TRIANGLES_PER_SLAB)
        .collect();
    let per_wave = (share.ln() / (waves.len() + 1) as f32).exp();
    for slabs in waves {
        wave(mesh, reference, slabs, per_wave, max_cost);
    }
    let stop = Stop {
        least: floor,
        most: None,
        max_cost,
    };
    simplify(mesh, &stop, None);
}

/// One wave of `slabs` slabs over `mesh`, each keeping `share` of its triangles.
fn wave(mesh: &mut Soup, reference: &Reference, slabs: usize, share: f32, max_cost: f32) {
    let mut parts = split(mesh, reference, slabs);
    mesh.vertices = Vec::new();
    mesh.indices = Vec::new();
    let mut seams = vec![Vec::new(); slabs];
    (parts.par_iter_mut().zip(seams.par_iter_mut())).for_each(|(part, seam)| {
        let stop = Stop {
            least: ceil_i32((part.indices.len() / 3) as f32 * share),
            most: None,
            max_cost,
        };
        simplify(part, &stop, Some(seam));
    });
    *mesh = weld(parts, &seams);
}
