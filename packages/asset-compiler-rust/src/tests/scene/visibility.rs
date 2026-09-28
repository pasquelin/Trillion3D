//! `KHR_node_visibility` (#519): a hidden node's mesh is compiled, to be shown later, and the node
//! table says it hidden; no coplanar surface, proxy triangle, oracle triangle or collider comes
//! from it. Provenance: the coplanar golden `full-overlap` (two coplanar squares, one per node),
//! its second node declaring itself hidden or not, and a body on it.
use super::*;
use crate::tests::golden::{compile_golden_source, golden_dir};

/// What the compiler derived from `full-overlap`, its node 1 a kinematic body hidden or not:
/// the compiled primitives, the coplanar surfaces, the proxy's triangles, the static instances,
/// the bodies cooked or refused, the oracle's triangles and node 1's table entry.
fn derived(hidden: bool) -> [Value; 7] {
    let fixture = golden_dir("coplanar/full-overlap");
    let root = scratch("visibility", if hidden { "hidden" } else { "shown" });
    fs::create_dir_all(&root).expect("root");
    fs::copy(
        fixture.join("full-overlap.bin"),
        root.join("full-overlap.bin"),
    )
    .expect("bin");
    let mut gltf = read_json(&fixture.join("full-overlap.gltf"));
    let mut extensions = json!({"KHR_physics_rigid_bodies":{"motion":{"isKinematic":true}}});
    if hidden {
        extensions["KHR_node_visibility"] = json!({"visible": false});
    }
    gltf["nodes"][1]["extensions"] = extensions;
    let source = root.join("full-overlap.gltf");
    fs::write(&source, serde_json::to_vec(&gltf).expect("gltf")).expect("write");
    let run = compile_golden_source(&source, "visibility");
    let proxy = (run.reports.iter())
        .find(|report| report["phase"] == "proxy")
        .map(|report| report["triangles"].clone());
    let key = run.result["key"].as_str().expect("key");
    let scope = run
        .cache
        .join("native")
        .join(run.result["scope"].as_str().expect("scope"));
    let tables = read_json(&scope.join(key).join("scene-tables.json"));
    let oracle = crate::oracle::scene::load(&source)
        .expect("oracle")
        .triangles
        .len();
    let physics = &run.result["physics"]["report"];
    let bodies = physics["bodies"].as_u64().expect("bodies")
        + physics["bodiesRefused"].as_array().map_or(0, Vec::len) as u64;
    let _ = fs::remove_dir_all(&root);
    [
        json!(run.result["primitives"].as_array().map(Vec::len)),
        run.result["coplanar"]["surfaces"].clone(),
        proxy.expect("proxy report"),
        physics["instances"].clone(),
        json!(bodies),
        json!(oracle / 9),
        tables["nodes"][1]["visible"].clone(),
    ]
}

#[test]
fn a_hidden_node_is_compiled_but_derives_no_surface_proxy_oracle_or_collider() {
    let [primitives, surfaces, proxy, instances, bodies, oracle, visible] = derived(false);
    assert_eq!(primitives, json!(2));
    assert_eq!(
        (surfaces, instances, bodies),
        (json!(2), json!(2), json!(1))
    );
    assert_eq!(visible, json!(true));
    let hidden = derived(true);
    assert_eq!(hidden[0], json!(2), "its mesh is compiled all the same");
    assert_eq!(hidden[1], json!(1), "no coplanar surface");
    assert!(
        hidden[2].as_u64() < proxy.as_u64(),
        "no proxy triangle: {proxy} then {}",
        hidden[2]
    );
    assert_eq!(
        (hidden[3].clone(), hidden[4].clone()),
        (json!(1), json!(0)),
        "no collider"
    );
    assert!(hidden[5].as_u64() < oracle.as_u64(), "no oracle triangle");
    assert_eq!(hidden[6], json!(false), "the table says it hidden");
}
