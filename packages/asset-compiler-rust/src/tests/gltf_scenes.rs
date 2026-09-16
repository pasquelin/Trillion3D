//! A06 — glTF 2.0 §3.5 : le document ne rend qu'une scène. Les nœuds et les lampes des autres, et
//! ceux qu'aucune scène ne nomme, n'appartiennent pas à ce qui est compilé.
use super::*;

/// Une source glTF directe : un triangle, cinq nœuds qui l'instancient, une lampe sur le nœud 3, et
/// le découpage en scènes que le test veut éprouver. `scene` absent laisse le document sans choix.
fn scenes_fixture(scenes: Option<Value>, scene: Option<usize>) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    let lampe = json!({"type":"point","color":[1.0,1.0,1.0],"intensity":10.0});
    gltf["nodes"] = json!([
        {"mesh":0},
        {"mesh":0},
        {"mesh":0},
        {"mesh":0,"extensions":{"KHR_lights_punctual":{"light":0}}},
        {"mesh":0},
    ]);
    gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[lampe]}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    if let Some(scenes) = scenes {
        gltf["scenes"] = scenes;
    }
    if let Some(scene) = scene {
        gltf["scene"] = json!(scene);
    }
    write_gltf(&options, &gltf, None);
    // Sans manifeste, le dossier est lu comme une source glTF directe : c'est le document lui-même,
    // et non un relevé écrit à côté, qui dit combien de nœuds il porte.
    fs::remove_file(options.source.join("manifest.json")).expect("source directe");
    options.scope = "full".into();
    (root, options)
}

/// Réécrit le glTF d'une source directe : sans manifeste, aucune empreinte n'est à restamper.
fn rewrite(options: &Options, gltf: &Value) {
    let bytes = serde_json::to_vec(gltf).expect("encode");
    fs::write(options.source.join("mesh.gltf"), bytes).expect("write");
}

/// Les nœuds retenus et le nombre de lampes publiées par une compilation.
fn compiled(options: &Options) -> (Vec<u64>, u64, u64) {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    let lights = read_json(&directory.join("lights.json"));
    (
        result["selectedNodes"]
            .as_array()
            .expect("nœuds")
            .iter()
            .map(|n| n.as_u64().expect("index"))
            .collect(),
        result["selectedTriangles"].as_u64().expect("triangles"),
        lights["count"].as_u64().expect("lampes"),
    )
}

// Comportement : `scene: 0` ne compile que les nœuds atteignables depuis les racines de la scène 0.
// Les nœuds de la scène 1, la lampe qu'ils portent et le nœud orphelin restent dehors.
#[test]
fn seule_la_scene_selectionnee_est_compilee() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0,1]},{"nodes":[2,3]}])), Some(0));
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1], "seuls les nœuds de la scène 0");
    assert_eq!(triangles, 2, "un triangle par nœud retenu");
    assert_eq!(lampes, 0, "la lampe de la scène 1 n'est pas de cette scène");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : la scène nommée emporte ses lampes, et elles seules.
#[test]
fn la_scene_nommee_emporte_ses_propres_lampes() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0,1]},{"nodes":[2,3]}])), Some(1));
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![2, 3], "seuls les nœuds de la scène 1");
    assert_eq!(triangles, 2);
    assert_eq!(lampes, 1, "la lampe du nœud 3 est dans la scène 1");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : un enfant suit son parent dans la scène, même nommé par aucune racine.
#[test]
fn les_enfants_des_racines_de_la_scene_suivent() {
    let (root, options) = scenes_fixture(Some(json!([{"nodes":[0]},{"nodes":[2]}])), Some(0));
    let mut gltf = read_gltf(&options);
    gltf["nodes"][0]["children"] = json!([1]);
    rewrite(&options, &gltf);
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1], "l'enfant du nœud 0 est dans la scène 0");
    assert_eq!(triangles, 2);
    assert_eq!(lampes, 0);
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : sans `scene` ni `scenes`, le document n'exclut personne — toutes les racines, donc
// tous les nœuds, sont compilés. C'est le contrat écrit dans `docs/COMPILER.md`.
#[test]
fn sans_scenes_toutes_les_racines_sont_compilees() {
    let (root, options) = scenes_fixture(None, None);
    let (nodes, triangles, lampes) = compiled(&options);
    assert_eq!(nodes, vec![0, 1, 2, 3, 4]);
    assert_eq!(triangles, 5);
    assert_eq!(lampes, 1);
    fs::remove_dir_all(root).expect("nettoyage");
}
