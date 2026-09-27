//! The pieces a breakable body is cut into at cook time: a node whose `extras.physics` declares
//! `breakable` (its threshold, as `obj.physics` takes it) has the closed mesh it collides by cut
//! into Voronoi cells (`voronoi.rs`) around seeds drawn inside it by a generator seeded from the
//! node, so the same source cooks the same bytes. Each piece is a convex hull Jolt builds for
//! contact (`hull.rs`), weighed exactly (`mass.rs`) at the body's scale. The pieces together weigh
//! what the mesh does, or the body is refused: only a convex mesh is cut, until a concave one is
//! decomposed into volumes.
use super::hull::cooked_shape;
use super::mass::solid_mass;
use super::refused;
use super::voronoi::{cells, face_planes, welded};
use crate::shared_math::{dot, extend_aabb, length, point, sub};
use crate::{Options, Result};
use rayon::prelude::*;
use serde_json::Value;

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

/// A number in [0, 1) from `state` (SplitMix64, Steele et al. 2014).
fn draw(state: &mut u64) -> f64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    // The top 53 bits, exact in an f64: the whole 64 would round up to 1 near `u64::MAX`.
    ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// The pieces of mesh `mesh`'s welded `triangles` over `pos`, seeded by `seed` and weighed at
/// `scale`: `physics.json` shapes, each `cooked` with its `mass`.
pub(super) fn pieces(
    o: &Options,
    (pos, triangles, mesh): (&[f32], &[u32], usize),
    seed: u64,
    scale: [f64; 3],
) -> Result<Vec<Value>> {
    let not_convex = || {
        refused(format!(
            "Mesh {mesh} is not convex: a breakable body is cut from a convex mesh."
        ))
    };
    let weight = |mass: &Value| mass["mass"].as_f64().unwrap_or_default();
    let whole = weight(&solid_mass(pos, triangles, scale, mesh)?);
    let corners = (pos.len() / 3) as u32;
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for i in 0..corners {
        extend_aabb(&mut low, &mut high, point(pos, i));
    }
    let planes = face_planes(pos, triangles);
    let eps = length(sub(high, low)) * 1e-6;
    let (mut state, mut seeds) = (seed, Vec::new());
    // A seed is a random mean of four corners: inside a convex mesh, whatever its shape.
    for _ in 0..ATTEMPTS {
        let picks: [(f64, [f64; 3]); 4] = std::array::from_fn(|_| {
            let w = draw(&mut state);
            (w, point(pos, (draw(&mut state) * corners as f64) as u32))
        });
        let total: f64 = picks.iter().map(|(w, _)| w).sum();
        let seed = [0, 1, 2].map(|k| picks.iter().map(|(w, p)| w * p[k]).sum::<f64>() / total);
        let inside = planes.iter().all(|&(n, c)| dot(n, seed) - c < -eps);
        if inside && seeds.iter().all(|s| length(sub(*s, seed)) > eps) {
            seeds.push(seed);
        }
        if seeds.len() == PIECES {
            break;
        }
    }
    if seeds.len() < 2 {
        return Err(not_convex());
    }
    let out: Vec<Value> = cells(&seeds, (low, high), &planes)
        .par_iter()
        .map(|faces| {
            let (pos, triangles) = welded(faces);
            let mut shape = cooked_shape(o, &pos)?;
            shape["mass"] = solid_mass(&pos, &triangles, scale, mesh)?;
            Ok(shape)
        })
        .collect::<Result<_>>()?;
    let total: f64 = out.iter().map(|piece| weight(&piece["mass"])).sum();
    if (total - whole).abs() > whole * MASS_TOLERANCE {
        return Err(not_convex());
    }
    Ok(out)
}
