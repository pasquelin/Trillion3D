//! What a prefab instance places, removes and replaces on its source prefab. Shared
//! meshes are in `meshes.rs`, properties in `properties.rs`.
use super::project::{
    cube, game_object, material_entry, node_named, white_mat, UnityProject, BUILTIN,
};
use super::*;

/// GUIDs of the files of each case.
const MAT: &str = "000000000000000000000000000000a1";
const SOURCE: &str = "000000000000000000000000000000a2";
const OUTER: &str = "000000000000000000000000000000a3";

/// A plain `.mat`, the shortest the driver reads.
fn matiere(name: &str) -> String {
    white_mat(name, "    - _Metallic: 0\n")
}

/// A root prefab instance, on the source of this GUID, with the case's overrides.
fn instance(id: u32, guid: &str, body: &str) -> String {
    format!(
        "--- !u!1001 &{id}\nPrefabInstance:\n  serializedVersion: 2\n  m_Modification:\n    m_TransformParent: {{fileID: 0}}\n{body}  m_SourcePrefab: {{fileID: 100100000, guid: {guid}, type: 3}}\n"
    )
}

/// An override that aims at this object of the source.
fn retouche(target: u32, guid: &str, path: &str, value: &str) -> String {
    format!("    - target: {{fileID: {target}, guid: {guid}, type: 3}}\n      propertyPath: {path}\n      value: {value}\n      objectReference: {{fileID: 0}}\n")
}

// Finding 47: a prefab instantiated in a prefab keeps its own overrides, and the
// outer instance places its own on top, in nesting order. Without that, everything
// the author changed from the scene on an object of the nested prefab is lost.
#[test]
fn the_outer_overrides_of_a_nested_prefab_reach_its_objects() {
    let projet = UnityProject::new("prefab-imbrique");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data("Prefabs/Inner.prefab", SOURCE, &cube(100, "Boite", MAT));
    projet.data(
        "Prefabs/Outer.prefab",
        OUTER,
        &instance(
            900,
            SOURCE,
            &format!(
                "    m_Modifications:\n{}",
                retouche(101, SOURCE, "m_LocalPosition.x", "1")
            ),
        ),
    );
    projet.scene(&instance(
        5000,
        OUTER,
        &format!(
            "    m_Modifications:\n{}",
            retouche(101, OUTER, "m_LocalPosition.x", "5")
        ),
    ));
    let (_, gltf) = projet.compile("unity-prefab-imbrique").prepared("unity");
    assert_eq!(
        node_named(&gltf, "Boite").expect("the nested prefab's object")["translation"],
        json!([5.0, 0.0, 0.0]),
        "the outer override wins over that of the nested prefab"
    );
}

// Finding 47: an instance does more than re-place its source. It removes components
// from it, adds objects to it, and adds components to it. A removed renderer emits
// nothing, an added object comes out under the object it aims at, and what remains
// out of reach is counted by its name.
#[test]
fn a_prefab_instance_removes_and_adds_objects_of_its_source() {
    let projet = UnityProject::new("prefab-retire");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data(
        "Prefabs/Source.prefab",
        SOURCE,
        &format!("{}{}", cube(100, "Gardee", MAT), cube(200, "Retiree", MAT)),
    );
    projet.scene(&format!(
        "{}{}",
        instance(
            5000,
            SOURCE,
            "    m_Modifications: []\n    m_RemovedComponents:\n    - {fileID: 203, guid: 000000000000000000000000000000a2, type: 3}\n    m_AddedGameObjects:\n    - targetCorrespondingSourceObject: {fileID: 101, guid: 000000000000000000000000000000a2, type: 3}\n      insertionIndex: -1\n      addedObject: {fileID: 701}\n    m_AddedComponents:\n    - targetCorrespondingSourceObject: {fileID: 100, guid: 000000000000000000000000000000a2, type: 3}\n      addedObject: {fileID: 801}\n"
        ),
        game_object(700, "Ajoutee", BUILTIN, &material_entry(MAT), 5001)
    ));
    let (manifest, gltf) = projet.compile("unity-prefab-retire").prepared("unity");
    assert!(
        node_named(&gltf, "Retiree").expect("the object remains")["mesh"].is_null(),
        "a renderer removed by the instance emits no mesh"
    );
    assert_eq!(
        node_named(&gltf, "Gardee").expect("the kept object")["children"],
        json!([rank_of(&gltf, "Ajoutee")]),
        "the added object comes out under the object the instance aims at"
    );
    assert_eq!(
        manifest["unsupported"]["unity-prefab-added-component-unconverted"],
        json!(1),
        "the added component is counted by name: {}",
        manifest["unsupported"]
    );
}

// Finding 48: a material slot an instance clears comes out without a material. Keeping
// the prefab's would make visible what the author had erased; a slot the instance does
// not name, itself, still keeps the prefab's.
#[test]
fn a_null_material_override_leaves_its_slot_without_a_material() {
    let projet = UnityProject::new("materiau-nul");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    projet.data("Prefabs/Source.prefab", SOURCE, &cube(100, "Boite", MAT));
    projet.scene(&instance(
        5000,
        SOURCE,
        "    m_Modifications:\n    - target: {fileID: 103, guid: 000000000000000000000000000000a2, type: 3}\n      propertyPath: m_Materials.Array.data[0]\n      value: \n      objectReference: {fileID: 0}\n",
    ));
    let (_, gltf) = projet.compile("unity-materiau-nul").prepared("unity");
    let mesh = node_named(&gltf, "Boite").expect("the object")["mesh"]
        .as_u64()
        .expect("its mesh") as usize;
    assert_eq!(
        gltf["meshes"][mesh]["primitives"][0]["material"],
        Value::Null,
        "the emptied slot comes out without a material"
    );
}

/// Rank of the node of this name in the intermediate scene.
fn rank_of(gltf: &Value, name: &str) -> Value {
    let nodes = gltf["nodes"].as_array().expect("nodes");
    json!(nodes
        .iter()
        .position(|node| node["name"] == name)
        .unwrap_or_else(|| panic!("the node {name}")))
}
