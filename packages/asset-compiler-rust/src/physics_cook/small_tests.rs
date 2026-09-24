//! Small triangles and refused colliders (#562): a tile Jolt would thin keeps its whole surface,
//! and a collider Jolt refuses is named in the report, never fatal.
use super::stage::gathered;
use super::tests::{cluster, golden_tile, RAMP, RAMP_TRIANGLES};
use super::*;

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

/// A 1 cm patch of 0.5 mm cells, bumped so no cell is flat: a chess piece's surface in metres,
/// every triangle under the 1e-6 doubled area Jolt keeps (`abeautiful-game`, #562).
fn fine_patch(scale: f32) -> (Vec<f32>, Vec<u32>) {
    let (n, step) = (20u32, 0.0005f32);
    let (mut pos, mut triangles) = (Vec::new(), Vec::new());
    for z in 0..=n {
        for x in 0..=n {
            let bump = ((x * 7 + z * 3) % 5) as f32 * step * 0.2;
            pos.extend([x as f32 * step, bump, z as f32 * step].map(|v| v * scale));
        }
    }
    for z in 0..n {
        for x in 0..n {
            let i = z * (n + 1) + x;
            triangles.extend([i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2]);
        }
    }
    (pos, triangles)
}

// Behaviour: a tile of small triangles keeps its whole surface — cooked scaled up by a power of
// two, exact, the very shape of the patch drawn that much larger, wrapped back down.
#[test]
fn a_tile_of_small_triangles_keeps_its_surface() {
    let (pos, triangles) = fine_patch(1.0);
    let cooked = mesh_shape(&pos, &triangles).expect("Jolt keeps the patch");
    let (large, _) = fine_patch(262_144.0); // 2^18: the 1 cm box brought past 2^11
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
