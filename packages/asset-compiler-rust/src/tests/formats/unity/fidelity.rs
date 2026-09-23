//! What the Unity scene says and that the driver must yield as-is: the place of
//! an imported model in its own hierarchy, the object each prefab override aims
//! at, a material's alpha mode, and the sixty-four-bit `fileID` that names a mesh.
//!
//! The driver's golden is in `golden.rs`, its refusals in `driver.rs`.
use super::project::{cube, instancie, mat_blanc, material_named, node_named, Projet};
use super::*;

/// GUID of each case's model, and that of the scene that cites it.
const MODEL: &str = "0000000000000000000000000000000a";

// Finding 29: a model referenced by the scene has its own hierarchy, and each
// node carries its transform — written as a matrix or as translation, rotation
// and scale. The driver composes them down to the mesh: the poured child comes
// out at the place the model gives it, not at the origin.
#[test]
fn the_transforms_of_an_imported_model_compose_down_to_its_meshes() {
    let projet = Projet::new("modele-transformations");
    projet.model(
        "Models/Piece.glb",
        MODEL,
        json!([
            {"name":"Bati","translation":[10.0,0.0,0.0],"children":[1]},
            {"name":"Piece","mesh":0,"translation":[0.0,5.0,0.0]},
        ]),
        "",
    );
    projet.scene(&instancie(
        "Socle",
        &format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}"),
    ));
    let run = projet.compile("unity-modele-transformations");
    let (_, gltf) = run.prepared("unity");
    let node = node_named(&gltf, "Piece").expect("the model's node");
    assert_eq!(
        node["matrix"],
        json!([1.0, 0., 0., 0., 0., 1.0, 0., 0., 0., 0., 1.0, 0., 10.0, 5.0, 0.0, 1.0]),
        "the model's parent matrix composes with that of its mesh"
    );
}

// Finding 30: a model instance's overrides each name their object. The one that
// aims at the root applies there; the one that aims at an object the driver does
// not yield separately is counted, never poured into another's transform. Ten
// runs yield the same scene, byte for byte.
#[test]
fn each_prefab_override_names_its_own_object_and_ten_runs_agree() {
    let projet = Projet::new("retouches");
    projet.model(
        "Models/Paire.glb",
        MODEL,
        json!([{"name":"Gauche","mesh":0},{"name":"Droite","mesh":0}]),
        "  - first:\n      4: 400002\n    second: Droite\n",
    );
    projet.scene(&format!(
        "--- !u!1001 &5000\nPrefabInstance:\n  serializedVersion: 2\n  m_Modification:\n    m_TransformParent: {{fileID: 0}}\n    m_Modifications:\n    - target: {{fileID: 400000, guid: {MODEL}, type: 3}}\n      propertyPath: m_LocalPosition.x\n      value: 7\n      objectReference: {{fileID: 0}}\n    - target: {{fileID: 400002, guid: {MODEL}, type: 3}}\n      propertyPath: m_LocalPosition.x\n      value: 2\n      objectReference: {{fileID: 0}}\n    - target: {{fileID: 100000, guid: {MODEL}, type: 3}}\n      propertyPath: m_Name\n      value: Instance\n      objectReference: {{fileID: 0}}\n  m_SourcePrefab: {{fileID: 100100000, guid: {MODEL}, type: 3}}\n"
    ));
    let first = projet.compile("unity-retouches").prepared("unity").1;
    assert_eq!(
        node_named(&first, "Instance").expect("the instance root")["translation"],
        json!([7.0, 0.0, 0.0]),
        "the root override applies alone, without the other object's value"
    );
    let (manifest, _) = projet.compile("unity-retouches").prepared("unity");
    assert_eq!(
        manifest["unsupported"]["unity-prefab-override-unplaced"], 1,
        "the override aiming at a model object is counted, not mixed"
    );
    for _ in 0..9 {
        assert_eq!(
            projet.compile("unity-retouches").prepared("unity").1,
            first,
            "two runs of the same scene yield the same intermediate scene"
        );
    }
}

// Finding 31: a sixty-four-bit `fileID` names a precise object. Read through a
// float, `2^53 + 1` falls back to `2^53`: the `.meta` name table yields nothing
// and the whole model is instanced in place of the only requested mesh.
#[test]
fn a_meta_file_id_beyond_the_float_range_still_names_its_mesh() {
    let projet = Projet::new("fileid");
    projet.model(
        "Models/Paire.glb",
        MODEL,
        json!([{"name":"Fine","mesh":0},{"name":"Grosse","mesh":0}]),
        "  - first:\n      43: 9007199254740993\n    second: Fine\n",
    );
    projet.scene(&instancie(
        "Socle",
        &format!("{{fileID: 9007199254740993, guid: {MODEL}, type: 3}}"),
    ));
    let run = projet.compile("unity-fileid");
    let (manifest, gltf) = run.prepared("unity");
    assert_eq!(manifest["source"]["counts"]["subMeshes"], 1);
    assert!(
        node_named(&gltf, "Fine").is_some() && node_named(&gltf, "Grosse").is_none(),
        "only the mesh the fileID names is instanced"
    );
    assert_eq!(
        manifest["unsupported"]["unity-model-mesh-by-fileid"],
        Value::Null
    );
}

// Finding 32: a material that is both transparent and cut out stays blended. The
// alpha-mode rule is read on the material properties: transparent wins, cutout
// alone yields `MASK`.
#[test]
fn a_material_that_is_both_transparent_and_cut_out_stays_blended() {
    let projet = Projet::new("alpha");
    let melange = "000000000000000000000000000000b1";
    let decoupe = "000000000000000000000000000000c1";
    projet.data(
        "Materials/Melange.mat",
        melange,
        &mat_blanc(
            "Melange",
            "    - _Surface: 1\n    - _AlphaClip: 1\n    - _Cutoff: 0.25\n",
        ),
    );
    projet.data(
        "Materials/Decoupe.mat",
        decoupe,
        &mat_blanc("Decoupe", "    - _Mode: 1\n    - _Cutoff: 0.25\n"),
    );
    projet.scene(&format!(
        "{}{}",
        cube(100, "Fondu", melange),
        cube(200, "Masque", decoupe)
    ));
    let run = projet.compile("unity-alpha");
    let (manifest, gltf) = run.prepared("unity");
    let fondu = material_named(&gltf, "Melange");
    assert_eq!(fondu["alphaMode"], "BLEND", "transparent wins over cutout");
    assert_eq!(
        fondu["alphaCutoff"],
        Value::Null,
        "glTF does not cut out a blended material"
    );
    let masque = material_named(&gltf, "Decoupe");
    assert_eq!(masque["alphaMode"], "MASK", "cutout alone stays masked");
    assert_eq!(masque["alphaCutoff"], 0.25);
    assert_eq!(manifest["unsupported"]["unity-material-clip-and-blend"], 1);
}
