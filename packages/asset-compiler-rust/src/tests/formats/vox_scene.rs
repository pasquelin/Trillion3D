//! The actual VOX fixture goes through the public compiler, not only reader tables.
use super::*;

#[test]
fn vox_cooked_scene_keeps_visible_instances_shared_meshes_and_material_identity() {
    let source = golden_dir("vox").join("scene.vox");
    let run = compile_golden_source(&source, "vox-scene");
    let (_, gltf) = run.prepared("vox");
    assert_eq!(gltf["meshes"].as_array().unwrap().len(), 1);
    assert_eq!(gltf["materials"].as_array().unwrap().len(), 2);
    let nodes = gltf["nodes"].as_array().unwrap();
    assert_eq!(nodes.iter().filter(|n| n["mesh"] == 0).count(), 3);
    assert!(nodes.iter().any(
        |n| n["name"] == "hidden" && n["extensions"]["KHR_node_visibility"]["visible"] == false
    ));
    super::scene_identity::hidden_materials_and_reuse(&run, &source);
}
