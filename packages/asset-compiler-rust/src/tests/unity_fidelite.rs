//! Ce que la scène Unity dit et que le pilote doit rendre tel quel : la place d'un modèle importé
//! dans sa propre hiérarchie, l'objet que chaque retouche de prefab vise, le mode alpha d'un
//! matériau, et le `fileID` de soixante-quatre bits qui nomme un maillage.
//!
//! Le doré du pilote est dans `unity_golden.rs`, ses refus dans `unity_driver.rs`.
use super::*;
use unity_projet::{cube, instancie, mat_blanc, material_named, node_named, Projet};

/// Le GUID du modèle de chaque cas, et celui de la scène qui le cite.
const MODEL: &str = "0000000000000000000000000000000a";

// Constat 29 : un modèle référencé par la scène a sa propre hiérarchie, et chaque nœud y porte sa
// transformation — écrite en matrice ou en translation, rotation et échelle. Le pilote les compose
// jusqu'au maillage : l'enfant versé sort à la place que le modèle lui donne, pas à l'origine.
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
    let node = node_named(&gltf, "Piece").expect("le nœud du modèle");
    assert_eq!(
        node["matrix"],
        json!([1.0, 0., 0., 0., 0., 1.0, 0., 0., 0., 0., 1.0, 0., 10.0, 5.0, 0.0, 1.0]),
        "la matrice du père du modèle se compose avec celle de son maillage"
    );
}

// Constat 30 : les retouches d'une instance de modèle nomment chacune leur objet. Celle qui vise la
// racine s'y applique ; celle qui vise un objet que le pilote ne rend pas à part est comptée, jamais
// versée dans la transformation d'un autre. Dix exécutions rendent la même scène, octet pour octet.
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
        node_named(&first, "Instance").expect("la racine de l'instance")["translation"],
        json!([7.0, 0.0, 0.0]),
        "la retouche de la racine s'applique seule, sans la valeur de l'autre objet"
    );
    let (manifest, _) = projet.compile("unity-retouches").prepared("unity");
    assert_eq!(
        manifest["unsupported"]["unity-prefab-override-unplaced"], 1,
        "la retouche visant un objet du modèle est comptée, pas mélangée"
    );
    for _ in 0..9 {
        assert_eq!(
            projet.compile("unity-retouches").prepared("unity").1,
            first,
            "deux exécutions de la même scène rendent la même scène intermédiaire"
        );
    }
}

// Constat 31 : un `fileID` de soixante-quatre bits nomme un objet précis. Lu au travers d'un
// flottant, `2^53 + 1` retombe sur `2^53` : la table de noms du `.meta` ne rend plus rien et le
// modèle entier est instancié à la place du seul maillage demandé.
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
        "seul le maillage que le fileID nomme est instancié"
    );
    assert_eq!(
        manifest["unsupported"]["unity-model-mesh-by-fileid"],
        Value::Null
    );
}

// Constat 32 : un matériau à la fois transparent et découpé reste fondu. La règle du mode alpha se
// lit sur les propriétés du matériau : transparent l'emporte, la découpe seule donne `MASK`.
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
    assert_eq!(
        fondu["alphaMode"], "BLEND",
        "transparent l'emporte sur la découpe"
    );
    assert_eq!(
        fondu["alphaCutoff"],
        Value::Null,
        "glTF ne découpe pas un matériau fondu"
    );
    let masque = material_named(&gltf, "Decoupe");
    assert_eq!(
        masque["alphaMode"], "MASK",
        "la découpe seule reste masquée"
    );
    assert_eq!(masque["alphaCutoff"], 0.25);
    assert_eq!(manifest["unsupported"]["unity-material-clip-and-blend"], 1);
}
