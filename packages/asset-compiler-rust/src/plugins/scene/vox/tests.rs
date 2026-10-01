use super::*;
use source::test_support::{attribute, read};
const SCENE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/vox/scene.vox"
));
const DEFAULT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/vox/default.vox"
));
const BUDGET: usize = 16 * 1024 * 1024;

#[test]
fn vox_surface_removes_internal_faces_without_merging_palette_materials() {
    let scene = read(&VOX, SCENE, BUDGET).unwrap();
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(
        scene.mesh_triangles,
        [20],
        "two cubes share two hidden faces"
    );
    let primitives = scene.meshes[0]["primitives"].as_array().unwrap();
    assert_eq!(primitives.len(), 2);
    for (index, primitive) in primitives.iter().enumerate() {
        assert_eq!(primitive["material"], index);
        let p = attribute(&scene, primitive, "POSITION");
        let n = attribute(&scene, primitive, "NORMAL");
        assert_eq!(p.len(), 5 * 4 * 3);
        assert_eq!(n.len(), p.len());
        for (point, normal) in p.as_chunks::<3>().0.iter().zip(n.as_chunks::<3>().0.iter()) {
            assert!(point[0] >= -1.0 && point[0] <= 1.0);
            assert!(point[1].abs() == 0.5 && point[2].abs() == 0.5);
            assert_eq!(normal.iter().map(|v| v.abs()).sum::<f32>(), 1.0);
        }
    }
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["metallicFactor"],
        0.6
    );
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["roughnessFactor"],
        0.2
    );
    assert_eq!(scene.materials[1]["emissiveFactor"], json!([0.0, 0.4, 0.0]));
    assert_eq!(scene.materials[1]["extras"]["voxPaletteIndex"], 2);
}

#[test]
fn vox_scene_keeps_instances_parent_transforms_layers_and_axis_conversion() {
    let scene = read(&VOX, SCENE, BUDGET).unwrap();
    assert_eq!(scene.nodes.len(), 9);
    assert_eq!(scene.nodes[0]["name"], "rig");
    assert_eq!(
        scene.nodes[0]["matrix"].as_array().unwrap()[12..15],
        json!([10.0, 20.0, 30.0]).as_array().unwrap()[..]
    );
    assert_eq!(scene.nodes[1]["children"], json!([2, 4, 6]));
    for index in [3, 5, 7] {
        assert_eq!(scene.nodes[index]["mesh"], 0);
    }
    assert_eq!(
        scene.nodes[2]["matrix"],
        json!([0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 3.0, 1.0])
    );
    assert_eq!(
        scene.nodes[6]["extensions"]["KHR_node_visibility"]["visible"],
        false
    );
    assert_eq!(
        scene.nodes[8]["matrix"],
        json!([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
    );
    assert_eq!(scene.nodes[8]["children"], json!([0]));
}

#[test]
fn vox_legacy_default_palette_uses_documented_red_ramp_and_centered_geometry() {
    let scene = read(&VOX, DEFAULT, BUDGET).unwrap();
    let color = &scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"];
    let expected = ((238.0_f64 / 255.0 + 0.055) / 1.055).powf(2.4);
    assert!((color[0].as_f64().unwrap() - expected).abs() < 1e-7);
    assert_eq!(color[1], 0.0);
    assert_eq!(color[2], 0.0);
    assert_eq!(scene.mesh_triangles, [12]);
    let positions = attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION");
    assert!(positions.iter().all(|v| v.abs() == 0.5));
}

#[test]
fn vox_refuses_truncation_unbounded_counts_duplicate_voxels_and_tiny_budget() {
    for end in [0, 7, 19, DEFAULT.len() - 1] {
        assert!(read(&VOX, &DEFAULT[..end], BUDGET).is_err());
    }
    let mut count = DEFAULT.to_vec();
    let xyzi = count.windows(4).position(|w| w == b"XYZI").unwrap();
    count[xyzi + 12..xyzi + 16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(read(&VOX, &count, BUDGET).is_err());
    let mut duplicate = SCENE.to_vec();
    let xyzi = duplicate.windows(4).position(|w| w == b"XYZI").unwrap();
    duplicate[xyzi + 20] = 0;
    assert!(read(&VOX, &duplicate, BUDGET).is_err());
    assert_eq!(
        read(&VOX, SCENE, 1024).err().unwrap().code,
        "IMPORT_OUT_OF_MEMORY"
    );
}

#[test]
fn vox_cancellation_is_observed_before_decoding_or_emitting_geometry() {
    let cancelled = std::sync::atomic::AtomicBool::new(true);
    let path = std::path::Path::new("fixture.vox");
    let request = SceneRequest {
        source: path,
        inputs: &[],
        cache: path,
        cancelled: &cancelled,
        progress: &|_| {},
        ram_budget: BUDGET,
    };
    let mut scene = SceneTables::new(&VOX);
    assert_eq!(
        (VOX.read)(SCENE, &request, &mut scene).unwrap_err().code,
        crate::CANCELLED
    );
    assert!(scene.meshes.is_empty());
}

#[test]
fn vox_glass_and_alpha_interfaces_keep_the_opaque_neighbour_face() {
    let mut glass = SCENE.to_vec();
    let at = glass.windows(5).position(|w| w == b"_emit").unwrap();
    // Update the string, material chunk and MAIN lengths together.
    glass.splice(at..at + 5, b"_glass".iter().copied());
    let matl = glass[..at].windows(4).rposition(|w| w == b"MATL").unwrap();
    let length = u32::from_le_bytes(glass[matl + 4..matl + 8].try_into().unwrap()) + 1;
    glass[matl + 4..matl + 8].copy_from_slice(&length.to_le_bytes());
    glass[at - 4..at].copy_from_slice(&6u32.to_le_bytes());
    let main = u32::from_le_bytes(glass[16..20].try_into().unwrap()) + 1;
    glass[16..20].copy_from_slice(&main.to_le_bytes());
    let scene = read(&VOX, &glass, BUDGET).unwrap();
    assert_eq!(scene.mesh_triangles, [24]);
    assert_eq!(
        scene.materials[1]["extensions"]["KHR_materials_transmission"]["transmissionFactor"],
        0.4
    );
    let mut alpha = SCENE.to_vec();
    let rgba = alpha.windows(4).position(|w| w == b"RGBA").unwrap();
    alpha[rgba + 12 + 7] = 128;
    assert_eq!(read(&VOX, &alpha, BUDGET).unwrap().mesh_triangles, [24]);
}
