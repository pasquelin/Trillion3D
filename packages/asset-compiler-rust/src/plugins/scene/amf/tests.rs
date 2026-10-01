use super::*;
use source::test_support::{attribute, read};
const FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/amf/two-instances.amf"
));
fn parse(text: &str) -> Result<SceneTables> {
    read(&AMF, text.as_bytes(), 1024 * 1024)
}

#[test]
fn amf_units_instances_and_authored_material_identity_are_preserved() {
    let scene = read(&AMF, FIXTURE, 1024 * 1024).unwrap();
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(scene.mesh_triangles, vec![1]);
    assert_eq!(scene.nodes.len(), 3);
    assert_eq!(scene.nodes[0]["mesh"], json!(0));
    assert_eq!(scene.nodes[1]["mesh"], json!(0));
    assert_eq!(scene.materials.len(), 1);
    assert_eq!(scene.materials[0]["name"], "material-7");
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([1.0, 0.0, 0.0, 1.0])
    );
    let p = &scene.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&scene, p, "POSITION"),
        vec![0., 0., 0., 0.0254, 0., 0., 0., 0.0508, 0.]
    );
    let matrix = scene.nodes[0]["matrix"].as_array().unwrap();
    assert!((matrix[0].as_f64().unwrap()).abs() < 1e-12);
    assert!((matrix[1].as_f64().unwrap() - 1.).abs() < 1e-12);
    assert_eq!(matrix[12], json!(0.0254));
    assert_eq!(scene.nodes[1]["matrix"][13], json!(0.0508));
}

#[test]
fn amf_corner_colours_override_triangle_volume_and_material_without_multiplication() {
    let text = std::str::from_utf8(FIXTURE)
        .unwrap()
        .replacen(
            "<vertex>",
            "<vertex><color><r>0</r><g>1</g><b>0</b></color>",
            1,
        )
        .replace(
            "<triangle>",
            "<triangle><color><r>0</r><g>0</g><b>1</b><a>0.5</a></color>",
        );
    let scene = parse(&text).unwrap();
    let p = &scene.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&scene, p, "COLOR_0"),
        vec![0., 1., 0., 1., 0., 0., 1., 0.5, 0., 0., 1., 0.5]
    );
    let material = &scene.materials[p["material"].as_u64().unwrap() as usize];
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorFactor"],
        json!([1.0, 1.0, 1.0, 1.0])
    );
    assert_eq!(material["alphaMode"], "BLEND");
    assert_eq!(material["extras"]["amfMaterial"], json!(7));
}

#[test]
fn amf_refuses_unknown_indices_cycles_external_entities_and_unsupported_semantics() {
    let text = std::str::from_utf8(FIXTURE).unwrap();
    for invalid in [
        text.replace("<v3>2</v3>", "<v3>9</v3>"),
        text.replace("objectid=\"1\"", "objectid=\"2\""),
        text.replace("materialid=\"7\"", "materialid=\"8\""),
        text.replace("<mesh>", "<mesh><edge/>"),
        text.replace("version=\"1.1\"", "version=\"99\""),
        text.replace("<x>1</x>", "<x>NaN</x>"),
        text.replace(
            "<amf ",
            "<!DOCTYPE amf [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><amf ",
        ),
    ] {
        assert!(parse(&invalid).is_err(), "must refuse {invalid}");
    }
    assert!(read(&AMF, FIXTURE, 512).is_err());
    assert!(read(&AMF, b"PK compressed", 1024).is_err());
}
