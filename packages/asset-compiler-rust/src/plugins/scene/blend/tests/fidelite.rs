//! La scène que le pilote retient, et la convention d'UV qu'il écrit.
use super::*;

// Comportement : un objet maillage qu'aucune collection de la scène active ne porte — orphelin,
// resté d'une autre scène — n'entre pas dans la scène convertie. Il est compté par son code, et les
// trois instances de la fixture sortent inchangées.
#[test]
fn an_object_no_collection_of_the_active_scene_holds_is_counted_and_left_out() {
    let bytes = surgery::with_stray_object(b"OBStray");
    let (gltf, manifest) = surgery::compiled(&bytes, "orphelin");
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
