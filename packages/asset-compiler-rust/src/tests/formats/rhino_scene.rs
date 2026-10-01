//! Independently authored 3DM goes through the public cooked-scene pipeline.
use super::*;

#[test]
fn rhino_cooked_scene_preserves_material_bindings_visibility_and_cache_identity() {
    let source = golden_dir("rhino").join("meshes.3dm");
    let run = compile_golden_source(&source, "rhino-scene");
    let (_, gltf) = run.prepared("rhino");
    assert_eq!(gltf["meshes"].as_array().unwrap().len(), 2);
    assert_eq!(gltf["materials"].as_array().unwrap().len(), 2);
    let triangle = gltf["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["name"] == "triangle")
        .unwrap();
    assert_eq!(
        triangle["extras"]["rhinoObjectId"],
        "00000000-0000-0000-0000-000000000001"
    );
    super::scene_identity::hidden_materials_and_reuse(&run, &source);
}
