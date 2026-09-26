//! Soft bodies cooked as the page builds them: their vertices weighed and pinned alike, their
//! settings Jolt's own bytes (a golden file), and a declaring node listed as a soft body in
//! `physics.json`, never as static ground.
use super::soft_record::{soft_record, SoftDeclared, SoftRecord};
use super::stage_physics;
use super::tests::assert_golden;
use super::{soft_settings, SOFT_VERTEX_WORDS as W};
use crate::compiler_coplanar::DepthLayerScene;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// The golden cloth: a 1 m square of 2 × 2 squares in the xy plane, its vertices row by row from
/// (−0.5, −0.5), pinned at its top corners (6, 8), bend 0.01 rad/(N·m).
const GOLDEN: &str = "../../tests/fixtures/physics/cloth-settings.bin";
fn cloth() -> (Vec<f32>, Vec<u32>) {
    let pos = (0..9).flat_map(|v| [(v % 3) as f32 * 0.5 - 0.5, (v / 3) as f32 * 0.5 - 0.5, 0.0]);
    let cells = [0u32, 1, 3, 4];
    let triangles = cells
        .iter()
        .flat_map(|&a| [a, a + 1, a + 4, a, a + 4, a + 3]);
    (pos.collect(), triangles.collect())
}
fn declared(kind: &'static str, pins: &[f64]) -> SoftDeclared {
    SoftDeclared {
        kind,
        pins: pins.to_vec(),
        mass: None,
        stretch: 0.0,
        bend: 0.01,
        pressure: None,
    }
}
// Behaviour: the cloth's vertices weigh the area each holds at 0.2 kg/m², its pins nothing, and
// its settings cook to the same bytes twice, the golden ones (`TRILLION3D_WRITE_GOLDEN` rewrites
// them); the cook's vertex stride is the worker's (`words.h`).
#[test]
fn a_cloth_cooks_to_the_golden_settings() {
    let words = include_str!("../../../physics-jolt-wasm/src/words.h");
    assert!(words.contains(&format!("SOFT_VERTEX_WORDS = {W};")));
    let (pos, triangles) = cloth();
    let pinned = declared("cloth", &[6.0, 8.0]);
    let record = soft_record(&pos, Some(&triangles), [1.0; 3], &pinned).unwrap();
    let masses: Vec<f32> = record.vertices.iter().skip(3).step_by(W).copied().collect();
    let total: f32 = masses.iter().sum();
    assert!(
        (masses[6], masses[8]) == (0.0, 0.0) && masses[4] > masses[0],
        "{masses:?}"
    );
    // The pins held a third of one triangle and of two, 0.125 m² of the whole square.
    assert!((total - 0.2 * (1.0 - 0.125)).abs() < 1e-6, "{total}");
    let cook = || soft_settings(&record.vertices, [1.0; 3], &record.indices, 0.0, 0.01).unwrap();
    let first = cook();
    assert_eq!(first, cook());
    assert_golden(&first, GOLDEN);
}

// Behaviour: as on the page, vertices at one position are one, a rope weighs its scaled length,
// a declared mass is spread, and a pin past the vertices or a lone point is refused in its words.
#[test]
fn a_primitive_is_welded_weighed_and_pinned_as_the_page_does() {
    let seam = [0.0f32, 0., 0., 1., 0., 0., 1., 0., 0., 2., 0., 0.];
    let rope = soft_record(&seam, None, [2.0, 1.0, 1.0], &declared("rope", &[0.0])).unwrap();
    let masses: Vec<f32> = rope.vertices.iter().skip(3).step_by(W).copied().collect();
    // Three vertices: the seam's two are one.
    assert_eq!(
        masses,
        [0.0, 0.065 * 2.0, 0.065],
        "4 m of rope, its hook held"
    );
    let heavy = SoftDeclared {
        mass: Some(3.0),
        ..declared("rope", &[])
    };
    let spread = soft_record(&seam, None, [1.0; 3], &heavy).unwrap();
    assert_eq!(spread.vertices.iter().skip(3).step_by(W).sum::<f32>(), 3.0);
    let pin = soft_record(&seam, None, [1.0; 3], &declared("rope", &[4.0]));
    assert_eq!(
        pin.err().unwrap(),
        "A soft body's pin 4 names no vertex of its 4."
    );
    let lone = soft_record(&seam[..3], None, [1.0; 3], &declared("rope", &[]));
    assert_eq!(lone.err().unwrap(), "A soft rope needs more vertices.");
}

// Behaviour: a node declaring a cloth in `extras.physics` is listed in `physics.json` with its
// cooked settings, placed by its node, and no static collider stands where it hangs; the floor
// beside it stays static ground, and a soft body of two primitives, or one declaring an option the
// page refuses on a soft body, is refused by name.
#[test]
fn a_declared_cloth_is_a_soft_body_of_physics_json_not_static_ground() {
    let (pos, triangles) = cloth();
    let mut bin = crate::import::f32_bytes(&pos);
    bin.extend(triangles.iter().flat_map(|i| i.to_le_bytes()));
    let physics = json!({"type":"cloth","pins":[6, 8],"bend":0.01,"gravityScale":0.5});
    let primitive = json!({"attributes":{"POSITION":0},"indices":1});
    let g = json!({
        "bufferViews":[{"buffer":0,"byteLength":108},{"buffer":0,"byteOffset":108,"byteLength":96}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":9},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":24}],
        "meshes":[{"primitives":[primitive]},{"primitives":[primitive, primitive]}],
        "nodes":[{"mesh":0,"translation":[0, 2, 0],"extras":{"physics":physics}},{"mesh":0},
            {"mesh":1,"extras":{"physics":{"type":"cloth"}}},
            {"mesh":0,"extras":{"physics":{"type":"cloth","sensor":true}}}],
    });
    let root =
        std::path::Path::new(env!("OUT_DIR")).join(format!("soft-cook-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    let (chosen, mesh_map) = (
        BTreeSet::from([0, 1, 2, 3]),
        BTreeMap::from([(0, 0), (1, 1)]),
    );
    let scene = DepthLayerScene {
        o: &o,
        g: &g,
        bin: &bin,
        chosen: &chosen,
        mesh_map: &mesh_map,
        cluster_planes: &[],
    };
    let primitives = [
        json!({"mesh":0,"primitive":0}),
        json!({"mesh":1,"primitive":0}),
    ];
    let collision = json!({"kind":"mesh","tiles":[],"triangles":8});
    stage_physics(&scene, &primitives, &[collision.clone(), collision], &root).unwrap();
    let written: Value =
        serde_json::from_slice(&std::fs::read(root.join("physics.json")).unwrap()).unwrap();
    let soft = &written["softBodies"][0];
    assert_eq!((&soft["node"], &soft["vertices"]), (&json!(0), &json!(9)));
    assert_eq!(
        soft["physics"]["pins"],
        json!([6, 8]),
        "the options, for the page"
    );
    assert_eq!(soft["position"], json!([0.0, 2.0, 0.0]));
    let sha = soft["settings"]["sha256"].as_str().unwrap();
    let stored = std::fs::read(o.cache.join(format!("native/objects/{sha}.bin"))).unwrap();
    assert_eq!(
        stored,
        std::fs::read(GOLDEN).unwrap(),
        "the cooked cloth is the golden one"
    );
    let instances = written["instances"].as_array().unwrap();
    assert_eq!(instances.len(), 1, "the floor alone is static ground");
    assert_eq!(instances[0]["node"], json!(1));
    let refused = &written["report"]["softRefused"];
    assert_eq!(
        refused,
        &json!([{"node":2,"reason":"A soft body is one primitive: its mesh holds 2."},
            {"node":3,"reason":"A soft body takes no sensor."}])
    );
    std::fs::remove_dir_all(root).unwrap();
}

/// The cook's soft records: `softCook.test.ts` rebuilds each with the page's `softBodyOf`, bit
/// for bit.
const RECORDS: &str = "../../tests/fixtures/physics/soft-records.bin";

/// A record as the fixture lays it, little-endian: `u32` word count, `f32` words (`x, y, z,
/// mass` per vertex), `u32` corner count, `u32` corners, `f64` pressure.
fn record_bytes(r: &SoftRecord) -> Vec<u8> {
    let mut out = (r.vertices.len() as u32).to_le_bytes().to_vec();
    out.extend(r.vertices.iter().flat_map(|v| v.to_le_bytes()));
    out.extend((r.indices.len() as u32).to_le_bytes());
    out.extend(r.indices.iter().flat_map(|i| i.to_le_bytes()));
    out.extend(r.pressure.to_le_bytes());
    out
}

// Behaviour: the cook weighs, welds, pins and pressurises three soft bodies — the golden cloth
// pinned at its top corners; a rope along x whose middle point is written twice (a seam), scaled
// 2 × 1 × 3 and given 0.3 kg, its hook held; a closed tetrahedron with its default pressure — into
// the golden records the page's test rebuilds with `softBodyOf`.
#[test]
fn the_cooks_soft_records_are_the_golden_ones_the_page_rebuilds() {
    let seam = [0.0f32, 0., 0., 1., 0., 0., 1., 0., 0., 2., 0.5, 0.];
    let tetra = [0.0f32, 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1.];
    let faces = [0u32, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    let rope = SoftDeclared {
        mass: Some(0.3),
        ..declared("rope", &[0.0])
    };
    let volume = SoftDeclared {
        bend: f64::INFINITY,
        ..declared("volume", &[])
    };
    let ((pos, triangles), pinned) = (cloth(), declared("cloth", &[6.0, 8.0]));
    let records = [
        soft_record(&pos, Some(&triangles), [1.0; 3], &pinned).unwrap(),
        soft_record(&seam, None, [2.0, 1.0, 3.0], &rope).unwrap(),
        soft_record(&tetra, Some(&faces), [1.0; 3], &volume).unwrap(),
    ];
    let bytes: Vec<u8> = records.iter().flat_map(record_bytes).collect();
    assert_golden(&bytes, RECORDS);
}
