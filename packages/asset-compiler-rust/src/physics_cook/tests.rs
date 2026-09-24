use super::cut::tolerance;
use super::declared::declared_matter;
use super::stage::{gathered, trs};
use super::*;
use crate::dag::DagCluster;

/// The golden tile: a 2 × 2 m quad tilted up along x, two triangles, cooked by native Jolt. The
/// physics module's tests restore these very bytes (`packages/sdk-browser/src/physics`).
const RAMP: [f32; 12] = [0., 0., -1., 2., 1., -1., 2., 1., 1., 0., 0., 1.];
const RAMP_TRIANGLES: [u32; 6] = [0, 2, 1, 0, 3, 2];
const GOLDEN: &str = "../../tests/fixtures/physics/ramp-tile.bin";

// Behaviour: the cook is deterministic and its bytes are the golden ones the runtime restores.
#[test]
fn a_tile_cooks_to_the_same_golden_bytes() {
    let first = mesh_shape(&RAMP, &RAMP_TRIANGLES).unwrap();
    assert_eq!(first, mesh_shape(&RAMP, &RAMP_TRIANGLES).unwrap());
    if std::env::var_os("TRILLION3D_WRITE_GOLDEN").is_some() {
        std::fs::write(GOLDEN, &first).unwrap();
    }
    assert_eq!(
        first,
        std::fs::read(GOLDEN).unwrap(),
        "golden tile moved: {GOLDEN}"
    );
}

// Behaviour: a regular grid is detected, sample for sample; one vertex off the lattice is not a grid.
#[test]
fn a_regular_grid_becomes_a_height_field() {
    let (n, mut pos, mut triangles) = (5usize, Vec::new(), Vec::new());
    for z in 0..n {
        for x in 0..n {
            pos.extend([x as f32 * 0.5, (x * z) as f32 * 0.1, z as f32 * 0.5]);
        }
    }
    for z in 0..n - 1 {
        for x in 0..n - 1 {
            let i = (z * n + x) as u32;
            triangles.extend([
                i,
                i + n as u32,
                i + 1,
                i + 1,
                i + n as u32,
                i + n as u32 + 1,
            ]);
        }
    }
    let grid = height::detect(&pos, &triangles).expect("a grid");
    assert_eq!((grid.size, grid.cells), (6, [4, 4]));
    assert_eq!(grid.samples[3 * grid.size + 2], 0.6f32);
    assert_eq!(grid.scale, [0.5, 1.0, 0.5]);
    assert!(height_field_shape(&grid.samples, grid.size, grid.offset, grid.scale).is_ok());
    pos[3 * 3] += 0.2;
    assert!(height::detect(&pos, &triangles).is_none());
}

pub(super) fn cluster(level: usize, lod_error: f64, parent_error: f64) -> DagCluster {
    DagCluster {
        indices: vec![0, 1, 2],
        level,
        lod_error,
        parent_error,
        sphere: [0.0; 4],
        parent_sphere: [0.0; 4],
        replacement: None,
        source_rank: 0,
        group: None,
        source: None,
    }
}

// Behaviour: the tolerance is the object's own — the median error of its first simplified level —
// and a DAG without one collides at level 0.
#[test]
fn the_tolerance_is_the_median_error_of_level_one() {
    let dag = [
        cluster(0, 0.0, 0.2),
        cluster(1, 0.3, 1.0),
        cluster(1, 0.1, 1.0),
        cluster(1, 0.2, 1.0),
    ];
    assert_eq!(tolerance(&dag), 0.2);
    assert_eq!(tolerance(&dag[..1]), 0.0);
}

// Behaviour: the measured distance of a cut to level 0 is the true gap: a quad lifted by 0.25
// against the flat one is 0.25 away, and a surface against itself is 0.
#[test]
fn the_hausdorff_distance_is_measured() {
    let mut pos = vec![0., 0., 0., 1., 0., 0., 1., 0., 1., 0., 0., 1.];
    pos.extend([0., 0.25, 0., 1., 0.25, 0., 1., 0.25, 1., 0., 0.25, 1.]);
    let (flat, lifted) = ([0u32, 1, 2, 0, 2, 3], [4u32, 5, 6, 4, 6, 7]);
    let gap = hausdorff::distance(&pos, &flat, &lifted);
    assert!((gap - 0.25).abs() < 1e-6, "{gap}");
    assert!(hausdorff::distance(&pos, &flat, &flat) < 1e-9);
}

// Behaviour: a node matrix splits into the pose a body takes; a sheared one is refused.
#[test]
fn a_node_matrix_splits_into_a_pose() {
    let turn = [0., 1., 0., 0., -1., 0., 0., 0., 0., 0., 1., 0.]; // a quarter turn about z
    let mut m = [0.0f64; 16];
    for c in 0..3 {
        for r in 0..3 {
            m[c * 4 + r] = turn[c * 4 + r] * 2.0;
        }
    }
    m[12..16].copy_from_slice(&[1.0, 2.0, 3.0, 1.0]);
    let (t, q, s) = trs(&m).unwrap();
    let half = std::f64::consts::FRAC_1_SQRT_2;
    assert_eq!((t, s), ([1.0, 2.0, 3.0], [2.0, 2.0, 2.0]));
    assert!(
        (q[2] - half).abs() < 1e-9 && (q[3] - half).abs() < 1e-9,
        "{q:?}"
    );
    m[5] += 0.5;
    assert!(trs(&m).is_none());
}

// Behaviour: a placement carries the friction and restitution its node's collider declares, and
// nothing when it declares none.
#[test]
fn a_node_carries_the_matter_its_collider_declares() {
    let g = serde_json::json!({"extensions":{"KHR_physics_rigid_bodies":{"physicsMaterials":[
        {"dynamicFriction":0.9,"restitution":0.2}
    ]}}});
    let node = serde_json::json!({"extensions":{"KHR_physics_rigid_bodies":{"collider":{"physicsMaterial":0}}}});
    let matter = declared_matter(&g, &node);
    assert_eq!(
        matter,
        serde_json::json!({"friction":0.9,"restitution":0.2})
    );
    assert_eq!(
        declared_matter(&g, &serde_json::json!({})),
        serde_json::json!({})
    );
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
