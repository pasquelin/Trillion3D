use std::{fs, sync::{Arc, atomic::AtomicBool}, time::{SystemTime, UNIX_EPOCH}};
use serde_json::{json, Value};
use web_geometry_compiler::{compile, Exact256, Options};

#[test]
fn single_cluster_keeps_exact_page_and_continues_past_first_coarse_level() {
    let root = std::env::temp_dir().join(format!("wg-coarse-levels-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    let source = root.join("source");
    fs::create_dir_all(&source).unwrap();
    let mut positions = Vec::new();
    for y in 0..=8 { for x in 0..=8 { positions.extend([x as f32, y as f32, 0.0]); } }
    let mut indices = Vec::new();
    for y in 0..8u32 { for x in 0..8u32 {
        let i = y * 9 + x;
        indices.extend([i, i + 1, i + 9, i + 1, i + 10, i + 9]);
    } }
    let position_bytes = positions.len() * 4;
    let mut bytes: Vec<u8> = positions.iter().flat_map(|v| v.to_le_bytes()).collect();
    let exact_bytes: Vec<u8> = indices.iter().flat_map(|v| v.to_le_bytes()).collect();
    bytes.extend(&exact_bytes);
    fs::write(source.join("grid.bin"), &bytes).unwrap();
    fs::write(source.join("grid.gltf"), serde_json::to_vec(&json!({
        "asset":{"version":"2.0"}, "buffers":[{"uri":"grid.bin","byteLength":bytes.len()}],
        "bufferViews":[{"buffer":0,"byteLength":position_bytes},{"buffer":0,"byteOffset":position_bytes,"byteLength":exact_bytes.len()}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":81},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "nodes":[{"mesh":0}], "materials":[], "images":[]
    })).unwrap()).unwrap();
    let options = Options { source, cache:root.join("cache"), resource_base:"/assets/".into(), scope:"full".into(), triangle_budget:150000, threads:1, ram_budget_mb:64, simplification:"qem-endpoints".into(), hierarchy:"tree".into(), cancelled:Arc::new(AtomicBool::new(false)) };
    let compiled = compile(&options, &Exact256, |_| {}).unwrap();
    let directory = options.cache.join("native/full").join(compiled["key"].as_str().unwrap());
    let primitive = &compiled["primitives"][0];
    let pages = primitive["pages"].as_array().unwrap();
    let exact: Vec<_> = pages.iter().filter(|p| p["role"] == "exact").collect();
    assert_eq!(exact.len(), 1);
    assert_eq!(fs::read(directory.join(exact[0]["url"].as_str().unwrap())).unwrap(), exact_bytes);
    let cost = |node: &Value| node["coarsePages"].as_array().unwrap().iter().map(|id| pages[id.as_u64().unwrap() as usize]["count"].as_u64().unwrap()).sum::<u64>();
    let tree = &primitive["hierarchy"];
    let child = &tree["children"][0];
    assert!(child.is_object(), "single-cluster LOD stopped after the first coarse representation");
    assert!(cost(tree) < cost(child));
    assert!(cost(tree) > 0);
    assert!(tree["errorObject"].as_f64().unwrap() >= child["errorObject"].as_f64().unwrap());
    assert_eq!(compiled["errorModel"], "bounds-diagonal-boundary-v1");
    let mut ancestor = tree;
    while ancestor["coarsePages"].is_array() {
        assert_eq!(ancestor["errorObject"].as_f64().unwrap(), 128_f64.sqrt());
        assert_eq!(ancestor["min"], json!([0.0, 0.0, 0.0]));
        assert_eq!(ancestor["max"], json!([8.0, 8.0, 0.0]));
        ancestor = &ancestor["children"][0];
    }
    assert_eq!(compiled["selectedTriangles"], 128);
    fs::remove_dir_all(root).unwrap();
}
