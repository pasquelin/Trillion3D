//! Small triangles and refused colliders (#562): a tile Jolt would thin keeps its whole surface,
//! and a collider Jolt refuses is named in the report, never fatal.
use super::stage::gathered;
use super::tests::{cluster, golden_tile, RAMP, RAMP_TRIANGLES};
use super::*;
use crate::shared_math::{cross, dot, sub};

/// The same ramp 2^-12 as large, under half a millimetre: Jolt drops both its triangles, so it is
/// cooked scaled up inside a `ScaledShape` (#562). The module's tests restore it under an instance
/// scale and cast against the drawn surface.
const SMALL_GOLDEN: &str = "../../tests/fixtures/physics/small-ramp-tile.bin";

// Behaviour: a tile of sub-millimetre triangles is cooked as the same ramp exactly 2^19 larger —
// the largest scale whose inverse Jolt accepts — inside a scaled shape; its bytes are the golden
// ones the runtime restores.
#[test]
fn a_small_tile_cooks_to_the_same_golden_bytes() {
    let cooked = golden_tile(&RAMP.map(|v| v / 4096.0), SMALL_GOLDEN);
    // Its 2^-11 box would need 2^22 to reach 2^11; 2^19 is the most Jolt takes: the ramp × 2^7.
    let whole = mesh_shape(&RAMP.map(|v| v * 128.0), &RAMP_TRIANGLES).unwrap();
    let body = &whole[whole.len() / 2..];
    assert!(cooked.windows(body.len()).any(|w| w == body));
}

/// 200 triangles of `abeautiful-game`'s pawn body, in metres (`tests/fixtures/physics/README.md`).
const PAWN_PATCH: &str = "../../tests/fixtures/physics/pawn-body-patch.bin";

/// The pawn patch's positions and triangle indices.
fn pawn_patch() -> (Vec<f32>, Vec<u32>) {
    let bytes = std::fs::read(PAWN_PATCH).unwrap();
    let words: Vec<u32> = bytes
        .as_chunks()
        .0
        .iter()
        .map(|&w| u32::from_le_bytes(w))
        .collect();
    let floats = 3 * words[0] as usize + 1;
    let pos = words[1..floats].iter().map(|&w| f32::from_bits(w));
    (pos.collect(), words[floats..].to_vec())
}

// Behaviour: the offending primitive of `abeautiful-game`, reduced, keeps its whole surface —
// cooked scaled up by a power of two, exact, the very shape of the patch drawn that much larger,
// wrapped back down. Unscaled, Jolt drops every one of its triangles and refuses the mesh.
#[test]
fn a_tile_of_small_triangles_keeps_its_surface() {
    let (pos, triangles) = pawn_patch();
    let at = |i: u32| std::array::from_fn(|k| pos[3 * i as usize + k] as f64);
    let dropped = triangles.as_chunks().0.iter().filter(|&&[a, b, c]| {
        let (a, b, c) = (at(a), at(b), at(c));
        let doubled = cross(sub(b, a), sub(c, a));
        dot(doubled, doubled) <= 1e-12 // `IndexedTriangle::IsDegenerate`
    });
    assert_eq!(dropped.count(), triangles.len() / 3);
    let cooked = mesh_shape(&pos, &triangles).expect("Jolt keeps the patch");
    let large: Vec<f32> = pos.iter().map(|v| v * 262_144.0).collect(); // 2^18: 1.35 cm past 2^11
    let whole = mesh_shape(&large, &triangles).unwrap();
    let body = &whole[whole.len() / 2..];
    assert!(cooked.windows(body.len()).any(|w| w == body));
}

// Behaviour: a primitive whose collider Jolt refuses (every triangle of zero area) collides with
// nothing and is named in the report with Jolt's reason; the cook does not fail.
#[test]
fn a_refused_collider_is_named_not_fatal() {
    let pos = [0., 0., 0., 0., 1., 0., 0., 2., 0.];
    let dag = [cluster(0, 0.0, f64::INFINITY)];
    let (order, culling) = crate::dag::build_culling_bvh(&pos, &dag);
    let o = crate::texture_preview::tests::options(&std::env::temp_dir());
    let collision = cook_primitive(&o, &dag, &order, &culling, &pos, &[0, 1, 2]).unwrap();
    let reason = collision["refused"].as_str().expect("refused");
    assert!(reason.contains("Need triangles"), "{reason}");
    let primitives = [
        serde_json::json!({"mesh":3,"primitive":1}),
        serde_json::json!({"mesh":4,"primitive":0}),
    ];
    let cooked = serde_json::json!({"kind":"mesh","tiles":[]});
    let (colliders, slot, refused) = gathered(&primitives, &[collision.clone(), cooked]);
    assert_eq!(
        (colliders.len(), slot.get(&0), slot.get(&1)),
        (1, None, Some(&0))
    );
    assert_eq!(
        refused,
        [serde_json::json!({"primitive":0,"mesh":3,"meshPrimitive":1,"reason":reason})]
    );
}
