//! The pieces a breakable body is cut into at cook time: a node whose `extras.physics` declares
//! `breakable` (its threshold, as `obj.physics` takes it) has the closed mesh it collides by cut
//! into Voronoi cells (`voronoi.rs`) around seeds drawn inside it by a generator seeded from the
//! node, so the same source cooks the same bytes. Each piece is a convex hull Jolt builds for
//! contact (`hull.rs`), weighed exactly (`mass.rs`) at the body's scale. The pieces together weigh
//! what the mesh does, or the body is refused: only a convex mesh is cut, until a concave one is
//! decomposed into volumes.
use super::cut::store_shape;
use super::hull::{hull_shape, Hull};
use super::mass::solid_mass;
use super::refused;
use super::voronoi::{cells, face_planes, welded};
use crate::shared_math::{dot, length, sub};
use crate::{Options, Result};
use serde_json::{json, Value};

/// Most pieces a breakable body is cut into.
pub(crate) const PIECES: usize = 12;
/// Seeds drawn before the cut settles for fewer pieces.
const ATTEMPTS: usize = 8 * PIECES;
/// Largest share of the mesh's mass the pieces may miss or add together: the rounding of their
/// corners to 32 bits, never a gap or an overlap.
pub(crate) const MASS_TOLERANCE: f64 = 1e-5;

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
    (z ^ (z >> 31)) as f64 / (u64::MAX as f64 + 1.0)
}

/// The pieces of `hull`'s mesh, seeded by `seed` and weighed at `scale`: `physics.json` shapes,
/// each `cooked` with its `mass`.
pub(super) fn pieces(o: &Options, hull: &Hull, seed: u64, scale: [f64; 3]) -> Result<Vec<Value>> {
    let not_convex = || {
        refused(format!(
            "Mesh {} is not convex: a breakable body is cut from a convex mesh.",
            hull.mesh
        ))
    };
    let whole = solid_mass(&hull.pos, &hull.welded, scale, hull.mesh)?["mass"].as_f64();
    let points: Vec<[f64; 3]> = hull
        .pos
        .as_chunks::<3>()
        .0
        .iter()
        .map(|p| p.map(f64::from))
        .collect();
    let (mut low, mut high) = ([f64::MAX; 3], [f64::MIN; 3]);
    for p in &points {
        for k in 0..3 {
            (low[k], high[k]) = (low[k].min(p[k]), high[k].max(p[k]));
        }
    }
    let planes = face_planes(&hull.pos, &hull.welded);
    let eps = length(sub(high, low)) * 1e-6;
    let (mut state, mut seeds) = (seed, Vec::new());
    // A seed is a random mean of four corners: inside a convex mesh, whatever its shape.
    for _ in 0..ATTEMPTS {
        let weights: Vec<(f64, [f64; 3])> = (0..4)
            .map(|_| {
                (
                    draw(&mut state),
                    points[(draw(&mut state) * points.len() as f64) as usize],
                )
            })
            .collect();
        let total: f64 = weights.iter().map(|(w, _)| w).sum();
        let seed = [0, 1, 2].map(|k| weights.iter().map(|(w, p)| w * p[k]).sum::<f64>() / total);
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
    let mut total = 0.0;
    let mut out = Vec::with_capacity(seeds.len());
    for faces in cells(&seeds, (low, high), &planes) {
        let (pos, triangles) = welded(&faces);
        let mass = solid_mass(&pos, &triangles, scale, hull.mesh)?;
        total += mass["mass"].as_f64().unwrap_or(0.0);
        let mut shape = store_shape(o, &hull_shape(&pos)?)?;
        shape["type"] = json!("cooked");
        shape["mass"] = mass;
        out.push(shape);
    }
    match whole {
        Some(whole) if (total - whole).abs() <= whole * MASS_TOLERANCE => Ok(out),
        _ => Err(not_convex()),
    }
}
