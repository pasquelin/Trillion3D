use super::*;
use source::test_support::{attribute, read};
#[test]
fn vrml_texture_fallback_transform_wrap_and_default_uv_are_preserved() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/vrml/textured.wrl");
    let scene = source::test_support::file(&VRML, &path, 1024 * 1024).unwrap();
    assert_eq!(scene.images[0]["uri"], "pixel.png");
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"],
        json!([1., 1., 1., 1.])
    );
    assert_eq!(scene.samplers[0]["wrapS"], 33071);
    assert_eq!(scene.samplers[0]["wrapT"], 10497);
    let transform = &scene.materials[0]["pbrMetallicRoughness"]["baseColorTexture"]["extensions"]
        ["KHR_texture_transform"];
    assert!((transform["offset"][0].as_f64().unwrap() - 1.25).abs() < 1e-12);
    assert!(transform["offset"][1].as_f64().unwrap().abs() < 1e-12);
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "TEXCOORD_0"),
        vec![0., 0., 1., 0., 0., 0.5]
    );
    let bytes = std::fs::read(path.with_file_name("pixel.png")).unwrap();
    assert_eq!(scene.files[0]["sha256"], crate::hash(&bytes));
}
#[test]
fn vrml_crease_angle_changes_only_normals_at_shared_edges() {
    let base="#VRML V2.0 utf8\nShape { geometry IndexedFaceSet { coord Coordinate { point [0 0 0 1 0 0 0 1 0 0 0 1] } coordIndex [0 1 2 -1 1 0 3 -1] creaseAngle ANGLE } }";
    let flat = read(&VRML, base.replace("ANGLE", "0").as_bytes(), 1024 * 1024).unwrap();
    let smooth = read(&VRML, base.replace("ANGLE", "2").as_bytes(), 1024 * 1024).unwrap();
    let get = |scene: &SceneTables, name| attribute(scene, &scene.meshes[0]["primitives"][0], name);
    assert_eq!(get(&flat, "POSITION"), get(&smooth, "POSITION"));
    assert_eq!(&get(&flat, "NORMAL")[..3], &[0., 0., 1.]);
    let normals = get(&smooth, "NORMAL");
    assert!((normals[1] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    assert!((normals[2] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
}

#[test]
fn vrml_indexed_lines_keep_segment_order_and_per_polyline_colour() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/vrml/lines.wrl");
    let scene = source::test_support::file(&VRML, &path, 1024 * 1024).unwrap();
    assert_eq!(scene.mesh_triangles, vec![0]);
    let p = &scene.meshes[0]["primitives"][0];
    assert_eq!(p["mode"], 1);
    assert_eq!(
        attribute(&scene, p, "POSITION"),
        vec![0., 0., 0., 1., 0., 0., 1., 0., 0., 1., 1., 0., 1., 1., 0., 0., 1., 0.]
    );
    assert_eq!(
        attribute(&scene, p, "COLOR_0"),
        vec![
            0., 1., 0., 1., 0., 1., 0., 1., 0., 1., 0., 1., 0., 1., 0., 1., 1., 0., 0., 1., 1., 0.,
            0., 1.
        ]
    );
    assert!(scene.materials[0]["extensions"]
        .get("KHR_materials_unlit")
        .is_some());
}

#[test]
fn vrml_material_def_identity_is_shared_without_merging_distinct_materials() {
    let shape="geometry IndexedFaceSet { coord Coordinate { point [0 0 0 1 0 0 0 1 0] } coordIndex [0 1 2 -1] }";
    let text=format!("#VRML V2.0 utf8\nShape {{ appearance Appearance {{ material DEF RED Material {{ diffuseColor 1 0 0 }} }} {shape} }}\nShape {{ appearance Appearance {{ material USE RED }} {shape} }}\nShape {{ appearance Appearance {{ material Material {{ diffuseColor 1 0 0 }} }} {shape} }}");
    let scene = read(&VRML, text.as_bytes(), 1024 * 1024).unwrap();
    assert_eq!(scene.materials.len(), 2);
    let ranks: Vec<_> = scene
        .meshes
        .iter()
        .map(|m| m["primitives"][0]["material"].as_u64().unwrap())
        .collect();
    assert_eq!(ranks, vec![0, 0, 1]);
}

#[test]
fn vrml_lines_use_emissive_or_white_and_ignore_transparency_and_texture() {
    for (appearance, color, expected) in [
        ("", "", json!([1., 1., 1., 1.])),
        ("appearance Appearance { material Material {} }", "", json!([0., 0., 0., 1.])),
        ("appearance Appearance { material Material { diffuseColor 1 0 0 emissiveColor 0 0.5 1 transparency 0.8 } texture ImageTexture { url [\"absent.png\"] } }", "", json!([0., 0.5, 1., 1.])),
        ("appearance Appearance { material Material { emissiveColor 0 0 1 transparency 1 } }", "color Color { color [1 0 0 0 1 0] }", json!([1., 1., 1., 1.])),
    ] {
        let input = format!("#VRML V2.0 utf8\nShape {{ {appearance} geometry IndexedLineSet {{ coord Coordinate {{ point [0 0 0 1 0 0] }} coordIndex [0 1 -1] {color} }} }}");
        let scene = read(&VRML, input.as_bytes(), 1024 * 1024).unwrap();
        let surface = &scene.materials[0];
        assert_eq!(surface["pbrMetallicRoughness"]["baseColorFactor"], expected);
        assert_eq!(surface["alphaMode"], "OPAQUE");
        assert_eq!(surface["extensions"]["KHR_materials_unlit"], json!({}));
        assert!(scene.images.is_empty());
    }
}
