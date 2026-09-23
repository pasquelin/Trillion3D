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
    let normals = normals::corners(&geometry.surface()).normals;
    let (mesh, _) = build::mesh_json(
        &geometry,
        &normals,
        &[None],
        "UV",
        &mut out,
        &std::sync::atomic::AtomicBool::new(false),
    )
    .expect("the mesh");
    let written: Vec<f32> = read(&out, &mesh["primitives"][0]["attributes"]["TEXCOORD_0"])
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| f32::from_le_bytes(*word))
        .collect();
    assert_eq!(
        written,
        vec![0.0, 1.0, 1.0, 0.75, 0.5, 0.0],
        "u is kept, v is flipped"
    );
}
