//! The scene the driver keeps, and the UV convention it writes.
use super::*;

// Behaviour: a mesh object that no collection of the active scene holds — orphaned, left from
// another scene — does not enter the converted scene. It is counted by its code, and the three
// instances of the fixture come out unchanged.
#[test]
fn an_object_no_collection_of_the_active_scene_holds_is_counted_and_left_out() {
    let bytes = surgery::with_stray_object(b"OBStray");
    let (gltf, manifest) = output::compiled(&bytes, "orphelin");
    let names: Vec<&str> = gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .map(|node| node["name"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(
        names,
        [
            "scene.blend",
            "SharedMesh_0",
            "SharedMesh_1",
            "SharedMesh_2"
        ],
        "the object outside a collection does not enter the scene"
    );
    assert_eq!(
        manifest["unsupported"]["blend-object-outside-scene"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
}

// Behaviour: Blender places the UV origin at the bottom left, glTF at the top left. The V
// coordinate is therefore flipped at write time, exactly as the ma, alembic and usd drivers do,
// or every imported texture would come out upside down.
#[test]
fn the_v_coordinate_is_flipped_like_in_the_other_drivers() {
    let geometry = Geometry {
        positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        corners: vec![0, 1, 2],
        offsets: vec![0, 3],
        uv: vec![0.0, 0.0, 1.0, 0.25, 0.5, 1.0],
        material: vec![0],
        sharp: vec![true],
        sharp_corners: Vec::new(),
    };
    let mut out = Out::default();
    let normals = computed_normals(&geometry).normals;
    let (mesh, _) = build::mesh_json(
        &geometry,
        &normals,
        &[None],
        "UV",
        &mut out,
        &std::sync::atomic::AtomicBool::new(false),
    )
    .expect("the mesh");
    let written = written(
        &out,
        &mesh["primitives"][0]["attributes"]["TEXCOORD_0"],
        accessor_floats,
    );
    assert_eq!(
        written,
        vec![0.0, 1.0, 1.0, 0.75, 0.5, 0.0],
        "u is kept, v is flipped"
    );
}

// Behaviour: the scene root carries the active scene's `scale_length`, the metres one Blender unit
// stands for, as a file in centimetres declares it; a scene with no unit system has no metres, and
// stays at one.
#[test]
fn the_root_carries_the_scale_of_the_scene_units() {
    let root_scale = |bytes: &[u8], tag: &str| {
        let (gltf, _) = output::compiled(bytes, tag);
        gltf["nodes"][0]["matrix"][0].as_f64().expect("the scale")
    };
    assert_eq!(root_scale(&surgery::fixture(), "unit-file"), 1.0);
    let centimetres = root_scale(&surgery::with_unit(0.01, 1), "unite-cm");
    assert!((centimetres - 0.01).abs() < 1e-9, "{centimetres}");
    assert_eq!(
        root_scale(&surgery::with_unit(0.01, 0), "unite-aucune"),
        1.0
    );
}
