//! Actual McNeel rhino3dm-authored archives exercise the independent Rust reader.
use super::*;
use source::test_support::{attribute, read};
const MESHES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/rhino/meshes.3dm"
));
const INSTANCES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/rhino/instances.3dm"
));
const EXACT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/rhino/untessellated.3dm"
));
const BUDGET: usize = 64 * 1024 * 1024;

#[test]
fn rhino_mesh_archive_keeps_identity_materials_hidden_nodes_and_metres() {
    let scene = read(&RHINO, MESHES, BUDGET).unwrap();
    assert_eq!(scene.meshes.len(), 2);
    assert_eq!(scene.materials.len(), 2);
    assert!(scene.materials.iter().any(|m| m["name"] == "red"
        && m["pbrMetallicRoughness"]["baseColorFactor"] == json!([1.0, 0.0, 0.0, 1.0])));
    assert!(scene.materials.iter().any(|m| m["name"] == "green"
        && m["pbrMetallicRoughness"]["baseColorFactor"] == json!([0.0, 1.0, 0.0, 1.0])));
    let triangle = scene
        .nodes
        .iter()
        .find(|n| n["name"] == "triangle")
        .unwrap();
    assert_eq!(
        triangle["extras"]["rhinoObjectId"],
        "00000000-0000-0000-0000-000000000001"
    );
    let mesh = triangle["mesh"].as_u64().unwrap() as usize;
    assert_eq!(
        attribute(&scene, &scene.meshes[mesh]["primitives"][0], "POSITION"),
        [0., 0., 0., 1., 0., 0., 0., 1., 0.]
    );
    assert!(scene.nodes.iter().any(
        |n| n["name"] == "hidden" && n["extensions"]["KHR_node_visibility"]["visible"] == false
    ));
}

#[test]
fn rhino_block_instances_share_local_mesh_and_keep_reflected_placements() {
    let scene = read(&RHINO, INSTANCES, BUDGET).unwrap();
    assert_eq!(
        scene.meshes.len(),
        1,
        "one source object used by two occurrences"
    );
    let nodes: Vec<_> = scene
        .nodes
        .iter()
        .filter(|n| n.get("mesh").is_some())
        .collect();
    assert_eq!(nodes.len(), 2);
    assert!(
        nodes
            .iter()
            .all(|n| n["mesh"] == 0
                && n["extras"]["rhinoInstancePath"].as_array().unwrap().len() == 1)
    );
    assert!(nodes
        .iter()
        .any(|n| n["matrix"][12] == 2.0 && n["matrix"][13] == 3.0 && n["matrix"][14] == 4.0));
    assert!(nodes
        .iter()
        .any(|n| n["matrix"][0] == -1.0 && n["matrix"][12] == -1.0));
    let p = attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION");
    for (actual, expected) in p.iter().zip([0., 0., 0., 1., 0., 0., 0., 1., 0.]) {
        assert!((actual - expected).abs() < 1e-6);
    }
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "NORMAL"),
        [0., 0., 1., 0., 0., 1., 0., 0., 1.]
    );
}

#[test]
fn rhino_refuses_untessellated_cad_truncation_budget_and_cancellation() {
    assert_eq!(
        read(&RHINO, EXACT, BUDGET).err().unwrap().code,
        "IMPORT_UNSUPPORTED"
    );
    assert!(read(&RHINO, &MESHES[..32], BUDGET).is_err());
    assert_eq!(
        read(&RHINO, MESHES, 1024).err().unwrap().code,
        "IMPORT_RESOURCE_LIMIT"
    );
    let cancelled = std::sync::atomic::AtomicBool::new(true);
    let path = std::path::Path::new("scene.3dm");
    let request = SceneRequest {
        source: path,
        inputs: &[],
        cache: path,
        cancelled: &cancelled,
        progress: &|_| {},
        ram_budget: BUDGET,
    };
    let mut scene = SceneTables::new(&RHINO);
    assert_eq!(
        (RHINO.read)(MESHES, &request, &mut scene).unwrap_err().code,
        crate::CANCELLED
    );
}

#[test]
fn rhino_authored_uv_colors_and_normals_survive_the_native_archive() {
    let bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/formats/rhino/attributes.3dm"
    ));
    let scene = read(&RHINO, bytes, BUDGET).unwrap();
    let primitive = &scene.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&scene, primitive, "TEXCOORD_0"),
        [0., 0., 1., 0., 0., 1.]
    );
    assert_eq!(
        attribute(&scene, primitive, "NORMAL"),
        [0., 0., 1., 0., 0., 1., 0., 0., 1.]
    );
    let colors = attribute(&scene, primitive, "COLOR_0");
    assert_eq!(&colors[..4], &[1., 1., 1., 1.]);
    let red = ((128.0_f64 / 255.0 + 0.055) / 1.055).powf(2.4);
    assert!((colors[4] as f64 - red).abs() < 1e-7);
    assert_eq!(&colors[5..], &[0., 0., 1., 0., 1., 0., 1.]);
}

#[test]
fn rhino_active_unsupported_material_optics_are_refused() {
    for (filename, reason) in [
        ("glossy.3dm", "legacy"),
        ("glass.3dm", "legacy"),
        ("pbr.3dm", "physically based"),
    ] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/formats/rhino")
            .join(filename);
        let bytes = std::fs::read(path).unwrap();
        let error = read(&RHINO, &bytes, BUDGET).err().unwrap();
        assert_eq!(error.code, "IMPORT_UNSUPPORTED");
        assert!(error.message.contains(reason), "{}", error.message);
    }
}
