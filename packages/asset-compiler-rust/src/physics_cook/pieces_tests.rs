//! The pieces a breakable body is cut into at cook time (`pieces.rs`): weighed beside its node,
//! cooked the same bytes from the same source, a scene without a breakable body left as it was.
use super::mass_tests::{cube, FACES};
use super::pieces::{MASS_TOLERANCE, PIECES};
use super::stage_physics;
use crate::compiler_coplanar::DepthLayerScene;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// `physics.json` of a scene of two unit cubes and an L of two boxes, the nodes as `nodes` declare
/// them, cooked into `name`.
fn cooked(name: &str, nodes: Value) -> (Vec<u8>, BTreeSet<String>) {
    let mut pos = cube([0.0; 3], [1.0; 3]);
    pos.extend(cube([0.0; 3], [4.0, 1.0, 1.0]));
    pos.extend(cube([0.0, 1.0, 0.0], [1.0, 3.0, 1.0]));
    let mut bin = crate::import::f32_bytes(&pos);
    for offset in [0, 8, 16] {
        bin.extend(FACES.iter().flat_map(|i| (i + offset).to_le_bytes()));
    }
    let (vertices, faces) = (pos.len() * 4, FACES.len() * 4);
    let g = json!({
        "bufferViews":[{"buffer":0,"byteLength":vertices},
            {"buffer":0,"byteOffset":vertices,"byteLength":faces * 3}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":pos.len() / 3},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":FACES.len()},
            {"bufferView":1,"byteOffset":faces,"componentType":5125,"type":"SCALAR","count":FACES.len() * 2}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]},
            {"primitives":[{"attributes":{"POSITION":0},"indices":2}]}],
        "extensions":{"KHR_implicit_shapes":{"shapes":[{"type":"box","box":{"size":[1, 1, 1]}}]}},
        "nodes":nodes,
    });
    let root =
        std::path::Path::new(env!("OUT_DIR")).join(format!("pieces-{name}-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    let count = g["nodes"].as_array().unwrap().len();
    let (chosen, mesh_map) = ((0..count).collect(), BTreeMap::from([(0, 0)]));
    let scene = DepthLayerScene {
        o: &o,
        g: &g,
        bin: &bin,
        chosen: &chosen,
        mesh_map: &mesh_map,
        cluster_planes: &[],
    };
    stage_physics(&scene, &[], &[], &root).unwrap();
    let written = std::fs::read(root.join("physics.json")).unwrap();
    let stored = std::fs::read_dir(o.cache.join("native/objects")).unwrap();
    let stored = stored.map(|e| e.unwrap().file_name().into_string().unwrap());
    let stored = stored.collect();
    std::fs::remove_dir_all(root).unwrap();
    (written, stored)
}

// Behaviour: a cube declaring `breakable` is cut into `PIECES` pieces, its seeds drawn from its own corners of the shared positions, each a stored hull
// weighed at the body's scale, which together weigh the cube within `MASS_TOLERANCE`; the file is
// format 3, cooked twice to the same bytes. Its body entry is otherwise the one it had declaring
// nothing breakable, in a format 2 file that carries no piece. A breakable L (not convex), a
// breakable body declaring its shape and a threshold of 0 are refused by name.
#[test]
fn a_breakable_body_is_cut_into_weighed_pieces_beside_its_node() {
    let body = |mesh: usize, collider: Value, extras: Value| {
        json!({"mesh":mesh,"scale":[2, 1, 1],"extras":{"physics":extras},
        "extensions":{"KHR_physics_rigid_bodies":{"motion":{},"collider":collider}}})
    };
    let (plain, _) = cooked("plain", json!([body(0, json!({}), json!({}))]));
    let breakable = json!([body(0, json!({}), json!({"breakable":5}))]);
    let (bytes, stored) = cooked("broken", breakable.clone());
    assert_eq!(bytes, cooked("again", breakable).0);
    let [plain, broken]: [Value; 2] = [plain, bytes].map(|b| serde_json::from_slice(&b).unwrap());
    assert_eq!([&plain, &broken].map(|f| &f["formatVersion"]), [2, 3]);
    let mut entry = broken["bodies"][0].clone();
    assert_eq!(entry["breakable"], json!(5.0));
    let pieces = entry["pieces"].as_array().unwrap().clone();
    assert_eq!(pieces.len(), PIECES, "seeds from mesh 0's corners");
    let stored = |p: &Value| stored.contains(&format!("{}.bin", p["sha256"].as_str().unwrap()));
    assert!(pieces.iter().all(|p| p["type"] == "cooked" && stored(p)));
    let kg = |p: &Value| p["mass"]["mass"].as_f64().unwrap();
    let total: f64 = pieces.iter().map(kg).sum();
    assert!((total / 2000.0 - 1.0).abs() <= MASS_TOLERANCE, "{total} kg");
    let map = entry.as_object_mut().unwrap();
    map.remove("breakable");
    map.remove("pieces");
    assert_eq!(entry, plain["bodies"][0]);
    let nodes = json!([
        body(1, json!({}), json!({"breakable":5})),
        body(0, json!({"geometry":{"shape":0}}), json!({"breakable":5})),
        body(0, json!({}), json!({"breakable":0}))
    ]);
    let (refusals, _) = cooked("refused", nodes);
    let refusals: Value = serde_json::from_slice(&refusals).unwrap();
    assert_eq!(
        refusals["report"]["bodiesRefused"],
        json!([{"node":0,"reason":"Mesh 1 is not convex: a breakable body is cut from a convex mesh."},
            {"node":1,"reason":"A breakable body is cut from its mesh: it declares no shape."},
            {"node":2,"reason":"A body's breakable is a threshold above 0: 0."}])
    );
}
