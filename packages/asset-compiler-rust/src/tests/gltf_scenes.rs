//! A06 — glTF 2.0 §3.5: the document renders only one scene. Nodes and lights of
//! the others, and those no scene names, do not belong to what is compiled.
use super::*;

/// A direct glTF source: a triangle, five nodes that instantiate it, a light on
/// node 3, and the scene split the test wants to try. Missing `scene` leaves the
/// document without a choice.
fn scenes_fixture(scenes: Option<Value>, scene: Option<usize>) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    let lampe = json!({"type":"point","color":[1.0,1.0,1.0],"intensity":10.0});
    gltf["nodes"] = json!([
        {"mesh":0},
        {"mesh":0},
        {"mesh":0},
        {"mesh":0,"extensions":{"KHR_lights_punctual":{"light":0}}},
        {"mesh":0},
    ]);
    gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[lampe]}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    if let Some(scenes) = scenes {
        gltf["scenes"] = scenes;
    }
    if let Some(scene) = scene {
        gltf["scene"] = json!(scene);
    }
    write_gltf(&options, &gltf, None);
    // Without a manifest, the folder is read as a direct glTF source: it is the
    // document itself, not a record written beside it, that says how many nodes it carries.
    fs::remove_file(options.source.join("manifest.json")).expect("source directe");
    options.scope = "full".into();
    (root, options)
}

/// Rewrites the glTF of a direct source: without a manifest, no fingerprint needs restamping.
fn rewrite(options: &Options, gltf: &Value) {
    let bytes = serde_json::to_vec(gltf).expect("encode");
    fs::write(options.source.join("mesh.gltf"), bytes).expect("write");
}

/// Kept nodes and the number of lights published by a compilation.
fn compiled(options: &Options) -> (Vec<u64>, u64, u64) {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    let lights = read_json(&directory.join("lights.json"));
    (
        result["selectedNodes"]
            .as_array()
            .expect("nodes")
            .iter()
            .map(|n| n.as_u64().expect("index"))
            .collect(),
        result["selectedTriangles"].as_u64().expect("triangles"),
        lights["count"].as_u64().expect("lampes"),
    )
}

// Behaviour: `scene: 0` compiles only nodes reachable from scene 0's roots.
// Scene 1's nodes, the light they carry and the orphan node stay out.
#[test]
fn seule_la_scene_selectionnee_est_compilee() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0,1]},{"nodes":[2,3]}])), Some(0));
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1], "only scene 0's nodes");
    assert_eq!(triangles, 2, "one triangle per kept node");
    assert_eq!(lampes, 0, "scene 1's light is not of this scene");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the named scene takes its lights, and only those.
#[test]
fn la_scene_nommee_emporte_ses_propres_lampes() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0,1]},{"nodes":[2,3]}])), Some(1));
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![2, 3], "only scene 1's nodes");
    assert_eq!(triangles, 2);
    assert_eq!(lampes, 1, "node 3's light is in scene 1");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a child follows its parent in the scene, even named by no root.
#[test]
fn les_enfants_des_racines_de_la_scene_suivent() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0]},{"nodes":[2]}])), Some(0));
    let mut gltf = read_gltf(&options);
    gltf["nodes"][0]["children"] = json!([1]);
    rewrite(&options, &gltf);
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1], "node 0's child is in scene 0");
    assert_eq!(triangles, 2);
    assert_eq!(lampes, 0);
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: without `scene` or `scenes`, the document excludes no one — every
// root, therefore every node, is compiled. That is the contract in `docs/COMPILER.md`.
#[test]
fn sans_scenes_toutes_les_racines_sont_compilees() {
    let (root, options) = scenes_fixture(None, None);
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1, 2, 3, 4]);
    assert_eq!(triangles, 5);
    assert_eq!(lampes, 1);
    fs::remove_dir_all(root).expect("cleanup");
}
