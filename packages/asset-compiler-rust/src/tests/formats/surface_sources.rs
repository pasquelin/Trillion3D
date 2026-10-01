//! Authored public-format fixtures enter through the normal compiler and cache.
use super::*;
#[test]
fn surface_sources_preserve_instances_triangles_materials_and_cache_identity() {
    for (format, extension, instances, triangles, materials) in [
        ("ply", "ply", 1, 2, 0),
        ("stl", "stl", 2, 2, 0),
        ("collada", "dae", 3, 3, 2),
        ("3mf", "3mf", 2, 2, 2),
        ("3ds", "3ds", 1, 2, 2),
        ("ifc", "ifc", 3, 20, 2),
    ] {
        let source = golden_dir(format).join(format!("scene.{extension}"));
        let run = compile_golden_source(&source, &format!("surface-{format}"));
        let (_, gltf) = run.prepared(format);
        let (actual_instances, actual_triangles) = source_stats(&gltf).unwrap();
        assert_eq!(
            (actual_instances, actual_triangles),
            (instances, triangles),
            "{format}"
        );
        assert_eq!(
            gltf["materials"].as_array().unwrap().len(),
            materials,
            "{format}"
        );
        assert!(!run.binary.is_empty(), "{format}: compiled mesh bytes");
        let (mut options, temporary) = golden_options(&source, &format!("surface-{format}-cache"));
        options.cache = run.cache.clone();
        let again = compile(&options, |_| {}).unwrap();
        assert_eq!(again["key"], run.result["key"], "{format}: cache identity");
        let _ = fs::remove_dir_all(temporary);
    }
}

#[test]
fn kmz_reuses_collada_surfaces_and_preserves_geographic_placement() {
    let source = golden_dir("kmz").join("scene.kmz");
    let run = compile_golden_source(&source, "kmz-model");
    let archives = run.cache.join("native/archives");
    let entry = fs::read_dir(archives).unwrap().next().unwrap().unwrap();
    let gltf = read_json(&entry.path().join("content/model.gltf"));
    assert_eq!(source_stats(&gltf).unwrap(), (3, 3));
    assert_eq!(gltf["materials"].as_array().unwrap().len(), 2);
    let node = gltf["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["name"] == "KML Model")
        .unwrap();
    assert_eq!(node["extras"]["localWgs84Origin"], json!([2., 48., 100.]));
    assert!((node["matrix"][2].as_f64().unwrap() - 2.).abs() < 1e-10);
    assert_eq!(run.result["selectedTriangles"], 3);
}
