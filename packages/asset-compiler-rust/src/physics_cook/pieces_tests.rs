//! The pieces a breakable body is cut into at cook time (`pieces.rs`, `voronoi.rs`): they tile the
//! solid, weigh what it weighs, cook the same bytes from the same source, and leave a scene without
//! a breakable body as it was.
use super::mass::{solid_mass, DENSITY};
use super::mass_tests::{cube, FACES};
use super::pieces::{MASS_TOLERANCE, PIECES};
use super::stage_physics;
use super::voronoi::{cells, clip, face_planes, welded};
use crate::compiler_coplanar::DepthLayerScene;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Share of a solid its cells may miss or overlap: their corners are rounded to 32 bits.
const TILED: f64 = 1e-6;

/// The volume the polytope `faces` bounds; 0 for none or a flat one.
fn volume(faces: &[Vec<[f64; 3]>]) -> f64 {
    let (pos, triangles) = welded(faces);
    solid_mass(&pos, &triangles, [1.0; 3], 0).map_or(0.0, |m| m["mass"].as_f64().unwrap() / DENSITY)
}

// Behaviour: the Voronoi cells of seeds inside a convex solid — a box, a pyramid leaning over one
// corner of its base, and a prism of many faces — tile it: their volumes sum to the solid's, and no two cells overlap,
// within `TILED` of it.
#[test]
fn voronoi_cells_tile_a_convex_solid_without_gap_or_overlap() {
    let pyramid = (
        vec![
            0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.5, 3.0, 2.0, 0.0,
        ],
        vec![0, 2, 1, 1, 2, 4, 0, 1, 3, 1, 4, 3, 4, 2, 3, 2, 0, 3],
    );
    // A 24-sided prism about (1, 0.5), radius 1.2, 0.5 high: 48 corners, 92 face triangles.
    let (mut prism, mut sides) = (Vec::new(), Vec::new());
    for k in 0..24u32 {
        let turn = k as f32 * std::f32::consts::TAU / 24.0;
        let (x, y) = (1.0 + 1.2 * turn.cos(), 0.5 + 1.2 * turn.sin());
        prism.extend([x, y, 0.0, x, y, 0.5]);
        let [a, b, c, d] = [2 * k, 2 * k + 1, (2 * k + 2) % 48, (2 * k + 3) % 48];
        sides.extend([a, c, b, b, c, d]);
        if k > 1 {
            sides.extend([0, 2 * k, 2 * k - 2, 1, 2 * k - 1, 2 * k + 1]);
        }
    }
    let solids = [
        (cube([0.0; 3], [2.0, 1.0, 0.5]), FACES.to_vec()),
        pyramid,
        (prism, sides),
    ];
    for (pos, triangles) in solids {
        let whole = solid_mass(&pos, &triangles, [1.0; 3], 0).unwrap()["mass"]
            .as_f64()
            .unwrap()
            / DENSITY;
        let planes = face_planes(&pos, &triangles);
        let seeds = [
            [0.3, 0.2, 0.1],
            [1.1, 0.4, 0.2],
            [0.5, 0.7, 0.3],
            [1.6, 0.3, 0.15],
        ];
        let bounds = ([-1.0; 3], [3.0, 2.0, 1.5]);
        let pieces = cells(&seeds, bounds, &planes);
        let total: f64 = pieces.iter().map(|faces| volume(faces)).sum();
        assert!((total - whole).abs() <= whole * TILED, "{total} of {whole}");
        for (i, a) in pieces.iter().enumerate() {
            assert!(volume(a) > 0.0, "cell {i} is empty");
            for b in &pieces[i + 1..] {
                let (pos, triangles) = welded(b);
                let shared = face_planes(&pos, &triangles)
                    .into_iter()
                    .fold(a.clone(), |faces, plane| clip(faces, plane, 1e-12));
                assert!(
                    volume(&shared) <= whole * TILED,
                    "overlap {}",
                    volume(&shared)
                );
            }
        }
    }
}

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
    let stored = stored
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    std::fs::remove_dir_all(root).unwrap();
    (written, stored)
}

// Behaviour: a cube declaring `breakable` is cut into 2 to `PIECES` pieces, each a stored hull
// weighed at the body's scale, which together weigh the cube within `MASS_TOLERANCE`; the file is
// format 3, cooked twice to the same bytes. Its body entry is otherwise the one it had declaring
// nothing breakable, in a format 2 file that carries no piece. A breakable L (not convex), a
// breakable body declaring its shape and a threshold of 0 are refused by name.
#[test]
fn a_breakable_body_is_cut_into_weighed_pieces_beside_its_node() {
    let body = |extras: Value| {
        json!({"mesh":0,"scale":[2, 1, 1],"extras":{"physics":extras},
        "extensions":{"KHR_physics_rigid_bodies":{"motion":{}}}})
    };
    let (plain, _) = cooked("plain", json!([body(json!({}))]));
    let (bytes, stored) = cooked("broken", json!([body(json!({"breakable":5}))]));
    assert_eq!(
        bytes,
        cooked("again", json!([body(json!({"breakable":5}))])).0
    );
    let [plain, broken]: [Value; 2] = [plain, bytes].map(|b| serde_json::from_slice(&b).unwrap());
    assert_eq!(
        (&plain["formatVersion"], &broken["formatVersion"]),
        (&json!(2), &json!(3))
    );
    let mut entry = broken["bodies"][0].clone();
    assert_eq!(entry["breakable"], json!(5.0));
    let pieces = entry["pieces"].as_array().unwrap().clone();
    assert!(
        (2..=PIECES).contains(&pieces.len()),
        "{} pieces",
        pieces.len()
    );
    let mut total = 0.0;
    for piece in &pieces {
        assert_eq!(piece["type"], json!("cooked"));
        assert!(stored.contains(&format!("{}.bin", piece["sha256"].as_str().unwrap())));
        total += piece["mass"]["mass"].as_f64().unwrap();
    }
    assert!(
        (total - 2000.0).abs() <= 2000.0 * MASS_TOLERANCE,
        "{total} kg"
    );
    let map = entry.as_object_mut().unwrap();
    map.remove("breakable");
    map.remove("pieces");
    assert_eq!(entry, plain["bodies"][0]);
    let rigid = |mesh: usize, collider: Value, breakable: Value| {
        json!({"mesh":mesh,
        "extras":{"physics":{"breakable":breakable}},
        "extensions":{"KHR_physics_rigid_bodies":{"motion":{},"collider":collider}}})
    };
    let (refusals, _) = cooked(
        "refused",
        json!([
            rigid(1, json!({}), json!(5)),
            rigid(0, json!({"geometry":{"shape":0}}), json!(5)),
            rigid(0, json!({}), json!(0))
        ]),
    );
    let refusals: Value = serde_json::from_slice(&refusals).unwrap();
    assert_eq!(
        refusals["report"]["bodiesRefused"],
        json!([{"node":0,"reason":"Mesh 1 is not convex: a breakable body is cut from a convex mesh."},
            {"node":1,"reason":"A breakable body is cut from its mesh: it declares no shape."},
            {"node":2,"reason":"A body's breakable is a threshold above 0: 0."}])
    );
}
