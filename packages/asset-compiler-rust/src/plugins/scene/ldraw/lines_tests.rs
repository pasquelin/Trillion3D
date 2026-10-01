use super::*;
use source::test_support::attribute;
#[test]
fn ldraw_lines_preserve_edge_colour_and_conditional_projection_controls() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/ldraw/lines.ldr");
    let scene = source::test_support::file(&LDRAW, &path, 1024 * 1024).unwrap();
    assert_eq!(scene.mesh_triangles, vec![0]);
    let primitives = scene.meshes[0]["primitives"].as_array().unwrap();
    assert_eq!(primitives.len(), 2);
    assert!(primitives.iter().all(|p| p["mode"] == 1));
    let conditional = primitives
        .iter()
        .find(|p| p["attributes"].get("_LDRAW_CONTROL0").is_some())
        .unwrap();
    assert_eq!(
        attribute(&scene, conditional, "POSITION"),
        vec![-0.004, 0., 0., 0.004, 0., 0.]
    );
    assert_eq!(
        attribute(&scene, conditional, "_LDRAW_CONTROL0"),
        vec![0., 0.004, 0.004, 0., 0.004, 0.004]
    );
    assert_eq!(
        attribute(&scene, conditional, "_LDRAW_CONTROL1"),
        vec![0., 0.004, -0.004, 0., 0.004, -0.004]
    );
    let ordinary = primitives
        .iter()
        .find(|p| p["attributes"].get("_LDRAW_CONTROL0").is_none())
        .unwrap();
    assert_eq!(attribute(&scene, ordinary, "POSITION").len(), 12);
    let material = &scene.materials[ordinary["material"].as_u64().unwrap() as usize];
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorFactor"],
        json!([0., 1., 0., 1.])
    );
    assert!(material["extensions"].get("KHR_materials_unlit").is_some());
}
