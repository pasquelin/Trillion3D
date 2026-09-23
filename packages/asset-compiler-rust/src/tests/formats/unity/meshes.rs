//! What a model mesh keeps of its own for each instance that cites it, and what
//! a `LODGroup` sets aside. Instance overrides are in `instances.rs`.
use super::project::{
    enfants, mat_blanc, material_index, materiau, node_named, objet, Projet, BUILTIN,
};
use super::*;

/// The file GUIDs for each case.
const MAT: &str = "000000000000000000000000000000a1";
const MODEL: &str = "0000000000000000000000000000000a";

/// A solid `.mat`, the shortest that the driver reads.
fn matiere(name: &str) -> String {
    mat_blanc(name, "    - _Metallic: 0\n")
}

// Finding 49: two renderers that point at the same model mesh do not carry the
// same materials. The poured mesh is shared; each different binding receives its
// variant, and the one an instance already placed without a binding is never
// rewritten under it.
#[test]
fn two_renderers_that_share_a_mesh_keep_their_own_materials() {
    let projet = Projet::new("maillage-partage");
    let (rouge, verte) = (
        "000000000000000000000000000000b1",
        "000000000000000000000000000000b2",
    );
    projet.data("Materials/Rouge.mat", rouge, &matiere("Rouge"));
    projet.data("Materials/Verte.mat", verte, &matiere("Verte"));
    projet.model(
        "Models/Piece.glb",
        MODEL,
        json!([{"name":"Piece","mesh":0}]),
        "",
    );
    let mesh = format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}");
    projet.scene(&format!(
        "{}{}{}",
        objet(100, "Nue", &mesh, "[]", 0),
        objet(200, "Rouge", &mesh, &materiau(rouge), 0),
        objet(300, "Verte", &mesh, &materiau(verte), 0)
    ));
    let (_, gltf) = projet.compile("unity-maillage-partage").prepared("unity");
    assert_eq!(
        material_of_child(&gltf, "Nue"),
        Value::Null,
        "the renderer that declares no material keeps the model mesh as-is"
    );
    assert_eq!(
        material_of_child(&gltf, "Rouge"),
        material_index(&gltf, "Rouge")
    );
    assert_eq!(
        material_of_child(&gltf, "Verte"),
        material_index(&gltf, "Verte")
    );
}

// Finding 50: a renderer that several levels of a `LODGroup` cite is kept at the
// most detailed level where it appears. Setting it aside because a coarse level
// also cites it would drop from LOD0 a surface the scene shows there.
#[test]
fn a_renderer_listed_in_two_lod_levels_is_kept_at_the_finest_one() {
    let projet = Projet::new("lod-partage");
    projet.data("Materials/Uni.mat", MAT, &matiere("Uni"));
    let group = "--- !u!1 &400\nGameObject:\n  serializedVersion: 6\n  m_Component:\n  - component: {fileID: 401}\n  - component: {fileID: 402}\n  m_Name: Groupe\n  m_IsActive: 1\n--- !u!205 &402\nLODGroup:\n  m_GameObject: {fileID: 400}\n  m_LODs:\n  - renderers:\n    - renderer: {fileID: 103}\n    - renderer: {fileID: 203}\n  - renderers:\n    - renderer: {fileID: 203}\n";
    projet.scene(&format!(
        "{group}{}{}{}",
        enfants(401, 400, 0, "\n  - {fileID: 101}\n  - {fileID: 201}"),
        objet(100, "Fine", BUILTIN, &materiau(MAT), 401),
        objet(200, "Partagee", BUILTIN, &materiau(MAT), 401)
    ));
    let (manifest, gltf) = projet.compile("unity-lod-partage").prepared("unity");
    for name in ["Fine", "Partagee"] {
        assert!(
            !node_named(&gltf, name).expect("the level's object")["mesh"].is_null(),
            "{name} is cited by the finest level: its mesh is kept"
        );
    }
    assert_eq!(
        manifest["source"]["counts"]["lodDropped"],
        Value::Null,
        "no renderer is set aside"
    );
}

/// Material carried by the mesh of this node's first child.
fn material_of_child(gltf: &Value, name: &str) -> Value {
    let node = node_named(gltf, name).unwrap_or_else(|| panic!("the node {name}"));
    let child = node["children"][0].as_u64().expect("a child") as usize;
    let mesh = gltf["nodes"][child]["mesh"].as_u64().expect("a mesh") as usize;
    gltf["meshes"][mesh]["primitives"][0]["material"].clone()
}
