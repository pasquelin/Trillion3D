//! The pieces a breakable body is cut into at cook time: a node whose `extras.physics` declares
//! `breakable` has the closed mesh it collides by cut into Voronoi cells (`voronoi.rs`) around seeds
//! drawn by a generator seeded from the node, the same source the same bytes; each piece is Jolt's
//! hull (`hull.rs`) weighed exactly (`mass.rs`). Pieces that do not weigh the mesh refuse the body:
//! only a convex mesh is cut, until a concave one is decomposed into volumes.
use super::hull::cooked_shape;
use super::mass::solid_mass;
use super::refused;
use super::voronoi::{cells, face_planes, welded};
use crate::{Options, Result};
use rayon::prelude::*;
use serde_json::Value;
use std::collections::BTreeSet;
use trillion3d_math::aabb::{aabb_of, diagonal};
use trillion3d_math::random::splitmix_draw as draw;
use trillion3d_math::vec3::{dot, length, point, sub};
use trillion3d_math::vecn::weighted_mean;

/// Most pieces a breakable body is cut into.
pub(super) const PIECES: usize = 12;
/// Seeds drawn before the cut settles for fewer pieces.
const ATTEMPTS: usize = 8 * PIECES;
/// Largest share of the mesh's mass the pieces may miss or add together: the rounding of their
/// corners to 32 bits, never a gap or an overlap.
pub(super) const MASS_TOLERANCE: f64 = 1e-5;

/// The threshold node `node` declares it breaks at, if it declares one.
pub(super) fn declared_breakable(node: &Value) -> Result<Option<f64>> {
    let Some(value) = node.pointer("/extras/physics/breakable") else {
        return Ok(None);
    };
    match value.as_f64() {
        Some(t) if t > 0.0 && t.is_finite() => Ok(Some(t)),
        _ => Err(refused(format!(
            "A body's breakable is a threshold above 0: {value}."
        ))),
    }
}

/// The pieces of mesh `mesh`'s welded `triangles` over `pos`, seeded by `seed` and weighed at
/// `scale`: `physics.json` shapes, each `cooked` with its `mass`.
pub(super) fn pieces(
    o: &Options,
    (pos, triangles, mesh): (&[f32], &[u32], usize),
    (seed, scale): (u64, [f64; 3]),
) -> Result<Vec<Value>> {
    let weight = |mass: &Value| mass["mass"].as_f64().unwrap_or_default();
    let whole = weight(&solid_mass(pos, triangles, scale, mesh)?);
    // The corners the triangles use: a shared accessor may hold positions of other meshes.
    let used: BTreeSet<u32> = triangles.iter().copied().collect();
    let corners: Vec<[f64; 3]> = used.into_iter().map(|i| point(pos, i)).collect();
    let (low, high) = aabb_of(corners.iter().copied());
    let eps = diagonal(low, high) * 1e-6;
    let planes = face_planes((pos, triangles), &corners, eps);
    let (mut state, mut seeds) = (seed, Vec::new());
    // A seed is a random mean of four corners: inside a convex mesh, whatever its shape.
    for _ in 0..ATTEMPTS {
        let picks: [(f64, [f64; 3]); 4] = std::array::from_fn(|_| {
            let w = draw(&mut state);
            let at = draw(&mut state) * corners.len() as f64;
            (w, corners[at as usize])
        });
        let seed = weighted_mean(picks.map(|(_, p)| p), picks.map(|(w, _)| w));
        let inside = planes.iter().all(|&(n, c)| dot(n, seed) - c < -eps);
        if inside && seeds.iter().all(|s| length(sub(*s, seed)) > eps) {
            seeds.push(seed);
        }
        if seeds.len() == PIECES {
            break;
        }
    }
    // Weighed before Jolt cooks and stores any: a mesh refused as concave stores no object.
    let weighed: Vec<(Vec<f32>, Value)> = cells(&seeds, (low, high), &planes, eps / 10.0)
        .par_iter()
        .map(|faces| {
            let (pos, triangles) = welded(faces);
            let mass = solid_mass(&pos, &triangles, scale, mesh)?;
            Ok((pos, mass))
        })
        .collect::<Result<_>>()?;
    let total: f64 = weighed.iter().map(|(_, mass)| weight(mass)).sum();
    // No seed inside, or cells that miss part of the mesh: its planes bound less than it.
    if (total - whole).abs() > whole * MASS_TOLERANCE {
        let reason = "is not convex: a breakable body is cut from a convex mesh";
        return Err(refused(format!("Mesh {mesh} {reason}.")));
    }
    (weighed.into_par_iter())
        .map(|(pos, mass)| {
            let mut shape = cooked_shape(o, &pos)?;
            shape["mass"] = mass;
            Ok(shape)
        })
        .collect()
}
