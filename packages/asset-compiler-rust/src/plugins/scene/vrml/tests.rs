use super::*;
use source::test_support::{attribute, read};
const FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/vrml/two-instances.wrl"
));
#[test]
fn vrml_def_use_concave_geometry_material_and_transform_are_preserved() {
    let scene = read(&VRML, FIXTURE, 1024 * 1024).unwrap();
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(scene.mesh_triangles, vec![3]);
    assert_eq!(
        scene
            .nodes
            .iter()
            .filter(|n| n.get("mesh").is_some())
            .count(),
        2
    );
    let matrix = &scene
        .nodes
        .iter()
        .find(|n| n.get("matrix").is_some())
        .unwrap()["matrix"];
    assert!((matrix[12].as_f64().unwrap() - 3.).abs() < 1e-12);
    assert!((matrix[13].as_f64().unwrap() + 1.).abs() < 1e-12);
    let positions = attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION");
    let area: f32 = positions
        .as_chunks::<9>()
        .0
        .iter()
        .map(|t| ((t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0])).abs() * 0.5)
        .sum();
    assert_eq!(area, 3.);
    let m = &scene.materials[0];
    assert_eq!(m["doubleSided"], true);
    assert_eq!(m["alphaMode"], "BLEND");
    assert_eq!(
        m["pbrMetallicRoughness"]["baseColorFactor"],
        json!([0.25, 0.5, 1., 0.75])
    );
}
#[test]
fn vrml_per_corner_colours_normals_and_uv_indices_survive_triangulation() {
    let text=b"#VRML V2.0 utf8\nShape { geometry IndexedFaceSet { coord Coordinate { point [0 0 0 1 0 0 0 1 0] } coordIndex [0 1 2 -1] color Color { color [1 0 0 0 1 0 0 0 1] } colorIndex [2 0 1 -1] normal Normal { vector [0 0 2] } normalPerVertex FALSE normalIndex [0] texCoord TextureCoordinate { point [0 0 1 0 0 1] } texCoordIndex [1 2 0 -1] } }";
    let scene = read(&VRML, text, 1024 * 1024).unwrap();
    let p = &scene.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&scene, p, "COLOR_0"),
        vec![0., 0., 1., 1., 1., 0., 0., 1., 0., 1., 0., 1.]
    );
    assert_eq!(
        attribute(&scene, p, "NORMAL"),
        vec![0., 0., 1., 0., 0., 1., 0., 0., 1.]
    );
    assert_eq!(
        attribute(&scene, p, "TEXCOORD_0"),
        vec![1., 0., 0., 1., 0., 0.]
    );
}
#[test]
fn vrml_refuses_cycles_external_execution_bad_indices_and_nonfinite_values() {
    for text in ["DEF C Group { children [USE C] }","USE absent","Script { }","Inline { url [\"https://example.com/model.wrl\"] }","Shape { geometry IndexedFaceSet { coord Coordinate { point [0 0 0] } coordIndex [0 1 2 -1] } }","Transform { translation NaN 0 0 }"] {
        let text=format!("#VRML V2.0 utf8\n{text}");assert!(read(&VRML,text.as_bytes(),1024*1024).is_err(),"must refuse {text}");
    }
    assert!(read(&VRML, FIXTURE, 512).is_err());
    assert!(read(&VRML, b"#VRML V1.0 ascii\nSeparator {}", 1024 * 1024).is_err());
}
