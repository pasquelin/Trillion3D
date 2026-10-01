use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
use std::io::{Cursor, Write};
const MODEL: &str = include_str!("../../../../../../tests/fixtures/formats/3mf/scene.model");
fn package(model: &str, target: &str) -> Vec<u8> {
    let mut writer = ::zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = ::zip::write::SimpleFileOptions::default();
    writer.start_file("_rels/.rels", options).unwrap();
    write!(writer,r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="{target}"/></Relationships>"#).unwrap();
    writer.start_file("3D/scene.model", options).unwrap();
    writer.write_all(model.as_bytes()).unwrap();
    writer.finish().unwrap().into_inner()
}
#[test]
fn build_components_units_transforms_and_base_identities_survive() {
    let scene = decode(&THREEMF, &package(MODEL, "/3D/scene.model"), 1 << 20).unwrap();
    assert_eq!(scene.mesh_triangles, [1]);
    assert_eq!(scene.materials.len(), 2);
    assert_eq!(scene.materials[0]["name"], "red-a");
    assert_eq!(scene.materials[1]["name"], "red-b");
    let instances: Vec<_> = scene
        .nodes
        .iter()
        .filter(|n| n["mesh"].is_number())
        .collect();
    assert_eq!(instances.len(), 2);
    assert_eq!(instances[0]["mesh"], instances[1]["mesh"]);
    assert_eq!(instances[0]["matrix"][12], 4.);
    assert_eq!(instances[1]["matrix"][0], 2.);
    assert_eq!(instances[1]["matrix"][13], 2.);
    let root = scene.nodes.last().unwrap();
    assert_eq!(root["matrix"][0], 0.01);
    assert_eq!(root["matrix"][9], 0.01);
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION"),
        [0., 0., 0., 10., 0., 0., 0., 10., 0.]
    );
}
#[test]
fn invalid_references_cycles_nonfinite_and_required_extensions_are_refused() {
    for model in [
        MODEL.replace("v3=\"2\"", "v3=\"9\""),
        MODEL.replace("objectid=\"2\"", "objectid=\"3\""),
        MODEL.replace("x=\"10\"", "x=\"NaN\""),
        MODEL.replace(
            "unit=\"centimeter\"",
            "unit=\"centimeter\" requiredextensions=\"unknown\"",
        ),
        MODEL.replace("id=\"2\"", "id=\"1\""),
    ] {
        assert!(decode(&THREEMF, &package(&model, "/3D/scene.model"), 1 << 20).is_err());
    }
    assert!(decode(&THREEMF, &package(MODEL, "../scene.model"), 1 << 20).is_err());
    assert!(decode(&THREEMF, &package(MODEL, "/3D/scene.model"), 1024).is_err());
}
#[test]
fn per_corner_colour_alpha_and_distinct_base_slots_survive() {
    let group = "<m:colorgroup id=\"4\"><m:color color=\"#FF000080\"/><m:color color=\"#00FF00\"/><m:color color=\"#0000FF\"/></m:colorgroup>";
    let model = MODEL
        .replace(
            "unit=\"centimeter\"",
            &format!("unit=\"centimeter\" xmlns:m=\"{MATERIALS}\" requiredextensions=\"m\""),
        )
        .replace("<object id=\"2\"", &format!("{group}<object id=\"2\""))
        .replace(
            "<triangle v1=\"0\" v2=\"1\" v3=\"2\"/>",
            "<triangle v1=\"0\" v2=\"1\" v3=\"2\" pid=\"4\" p1=\"0\" p2=\"1\" p3=\"2\"/>",
        );
    let scene = decode(&THREEMF, &package(&model, "/3D/scene.model"), 1 << 20).unwrap();
    let primitive = &scene.meshes[0]["primitives"][0];
    let rgba = attribute(&scene, primitive, "COLOR_0");
    assert_eq!(&rgba[..3], &[1., 0., 0.]);
    assert!((rgba[3] - 128. / 255.).abs() < 1e-7);
    assert_eq!(&rgba[4..], &[0., 1., 0., 1., 0., 0., 1., 1.]);
    assert_eq!(
        scene.materials[primitive["material"].as_u64().unwrap() as usize]["alphaMode"],
        "BLEND"
    );
    let model = MODEL.replace("pindex=\"0\"", "pindex=\"1\"");
    let scene = decode(&THREEMF, &package(&model, "/3D/scene.model"), 1 << 20).unwrap();
    assert_eq!(scene.meshes[0]["primitives"][0]["material"], 1);
}
#[test]
fn reflected_instances_keep_authored_triangles_and_negative_matrix_axis() {
    let model = MODEL.replace("2 0 0 0 3 0 0 0 4 1 2 3", "-2 0 0 0 3 0 0 0 4 1 2 3");
    let scene = decode(&THREEMF, &package(&model, "/3D/scene.model"), 1 << 20).unwrap();
    assert!(scene.nodes.iter().any(|n| n["matrix"][0] == -2.));
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION"),
        [0., 0., 0., 10., 0., 0., 0., 10., 0.]
    );
}
