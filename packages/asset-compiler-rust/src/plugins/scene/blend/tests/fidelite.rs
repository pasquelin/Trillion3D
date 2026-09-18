//! La scène que le pilote retient, et la convention d'UV qu'il écrit.
use super::*;

// Comportement : un objet maillage qu'aucune collection de la scène active ne porte — orphelin,
// resté d'une autre scène — n'entre pas dans la scène convertie. Il est compté par son code, et les
// trois instances de la fixture sortent inchangées.
#[test]
fn an_object_no_collection_of_the_active_scene_holds_is_counted_and_left_out() {
    let bytes = surgery::with_stray_object(b"OBStray");
    let (gltf, manifest) = sortie::compiled(&bytes, "orphelin");
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
        "l'objet hors collection n'entre pas dans la scène"
    );
    assert_eq!(
        manifest["unsupported"]["blend-object-outside-scene"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
}

// Comportement : Blender place l'origine des UV en bas à gauche, le glTF en haut à gauche. La
// coordonnée V est donc retournée à l'écriture, exactement comme les pilotes ma, alembic et usd le
// font, sans quoi toute texture importée sort à l'envers.
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
    .expect("le maillage");
    let written: Vec<f32> = read(&out, &mesh["primitives"][0]["attributes"]["TEXCOORD_0"])
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| f32::from_le_bytes(*word))
        .collect();
    assert_eq!(
        written,
        vec![0.0, 1.0, 1.0, 0.75, 0.5, 0.0],
        "u est conservé, v est retourné"
    );
}
