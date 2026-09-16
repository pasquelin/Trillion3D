//! Q — `SceneLight.emitterRadius` : le rayon de l'enveloppe qu'une lampe cesse d'occulter.
//!
//! Deux provenances, dans cet ordre : le rayon que la source déclare sur la lampe, sinon celui que
//! mesure le corps émissif lié à elle par la parenté du graphe. Le contrat (`docs/SDK.md`) le veut
//! en mètres, strictement positif, strictement sous la portée, et jamais sur une directionnelle.
use super::*;

/// La lampe ponctuelle des cas synthétiques, à 3 m de portée sauf quand le cas la resserre.
fn lampe(range: f64) -> Value {
    json!({"type":"point","color":[1.0,1.0,1.0],"intensity":1000.0,"range":range})
}
/// Un matériau qui émet, et un qui n'émet pas : c'est la seule chose qui distingue une enveloppe
/// d'un mur, et le compilateur ne regarde rien d'autre — ni le nom du nœud, ni celui du maillage.
fn emissif(yes: bool) -> Value {
    let factor = if yes { 1.0 } else { 0.0 };
    json!({"name":"m","emissiveFactor":[factor,factor,factor]})
}
/// Les nœuds du cas courant : deux instances du triangle de la fixture, puis la lampe.
fn a_cote(lamp_node: Value) -> Value {
    json!([{"mesh":0},{"mesh":0}, lamp_node])
}
/// Une source glTF directe portant ce matériau, cette lampe et ces nœuds. Sans manifeste, c'est le
/// document lui-même qui dit ce qu'il contient : le cas n'a rien à restamper.
fn scene(material: Value, light: Value, nodes: Value) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["materials"] = json!([material]);
    gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    gltf["nodes"] = nodes;
    gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[light]}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
    write_gltf(&options, &gltf, None);
    fs::remove_file(options.source.join("manifest.json")).expect("source directe");
    options.scope = "full".into();
    (root, options)
}
/// Le produit `lights.json` d'une compilation, tel qu'un hôte le lira.
fn lights_of(options: &Options) -> Value {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options
        .cache
        .join("native/full")
        .join(result["key"].as_str().expect("key"));
    read_json(&directory.join("lights.json"))
}
/// Le rayon écrit sur la première lampe, et les codes que l'étape a comptés.
fn radius_and_counts(options: &Options) -> (Option<f64>, Value) {
    let lights = lights_of(options);
    assert_eq!(lights["count"], json!(1), "une lampe attendue : {lights}");
    (
        lights["lights"][0]
            .get("emitterRadius")
            .and_then(Value::as_f64),
        lights["counts"].clone(),
    )
}
/// La demi-diagonale attendue des cas synthétiques : le triangle de la fixture porte ses sommets à
/// racine de deux sur deux du point (0,5 ; 0,5 ; 0) où la lampe est posée.
const DEMI_DIAGONALE: f64 = std::f64::consts::SQRT_2 / 2.0;
fn lampe_a_cote() -> Value {
    json!({"name":"lampe","translation":[0.5,0.5,0.0],"extensions":{"KHR_lights_punctual":{"light":0}}})
}

// Comportement : un frère direct dont le matériau émet est l'enveloppe de la lampe ; son rayon est
// la plus grande distance du centre à l'un de ses sommets, et la provenance est comptée.
#[test]
fn un_frere_emissif_donne_le_rayon_de_l_enveloppe() {
    let (root, options) = scene(emissif(true), lampe(3.0), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert!(
        (radius.expect("rayon") - DEMI_DIAGONALE).abs() < 1e-12,
        "{radius:?}"
    );
    assert_eq!(counts["light-emitter-radius-derived"], json!(1));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : le maillage du nœud parent fait enveloppe au même titre qu'un frère.
#[test]
fn le_maillage_du_parent_fait_enveloppe() {
    let lamp = json!({"name":"lampe","extensions":{"KHR_lights_punctual":{"light":0}}});
    let nodes = json!([{"mesh":0,"children":[2]},{"mesh":0}, lamp]);
    let (root, options) = scene(emissif(true), lampe(3.0), nodes);
    let (radius, counts) = radius_and_counts(&options);
    assert!((radius.expect("rayon") - 1.0).abs() < 1e-12, "{radius:?}");
    assert_eq!(counts["light-emitter-radius-derived"], json!(1));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : sans corps émissif autour d'elle, la lampe ne déclare aucun rayon et rien n'est
// compté — le produit est mot pour mot celui d'avant ce lot.
#[test]
fn sans_corps_emissif_le_champ_reste_absent() {
    let (root, options) = scene(emissif(false), lampe(3.0), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : le rayon que la source déclare sur la lampe passe avant toute mesure, et n'est pas
// compté comme dérivé — il ne vient pas de la scène, il vient du fichier.
#[test]
fn le_rayon_declare_par_la_source_passe_avant_l_enveloppe() {
    let mut light = lampe(3.0);
    light["extras"] = json!({"emitterRadius":0.25});
    let (root, options) = scene(emissif(true), light, a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, Some(0.25));
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : une directionnelle n'a pas de centre ; le contrat lui refuse le champ, même
// entourée d'un corps émissif, et rien n'est compté puisque rien n'a été tenté.
#[test]
fn une_directionnelle_ne_recoit_jamais_de_rayon() {
    let mut light = lampe(3.0);
    light["type"] = json!("directional");
    let (root, options) = scene(emissif(true), light, a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts, json!({}));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : une enveloppe aussi large que la portée n'en est plus une. Le rayon est compté
// sous son code et le champ reste absent, plutôt que d'exclure au-delà de ce qu'elle contient.
#[test]
fn un_rayon_au_dela_de_la_portee_est_compte_et_omis() {
    let (root, options) = scene(emissif(true), lampe(0.5), a_cote(lampe_a_cote()));
    let (radius, counts) = radius_and_counts(&options);
    assert_eq!(radius, None);
    assert_eq!(counts["light-emitter-radius-invalid"], json!(1));
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : la fixture livrée avec le paquet donne le rayon que son README annonce — 0,20 m,
// la distance du centre de la lampe aux sommets de son enveloppe émissive — sans aucune retouche.
#[test]
fn la_fixture_emetteur_sphere_produit_son_rayon() {
    let run = compile_golden(&golden_dir("classes-materiaux"), "emetteur-sphere");
    let key = run.result["key"].as_str().expect("key");
    let lights = read_json(&run.cache.join("native/full").join(key).join("lights.json"));
    let radius = lights["lights"][0]["emitterRadius"]
        .as_f64()
        .expect("rayon");
    assert!((radius - 0.2).abs() < 1e-6, "{radius}");
    assert_eq!(lights["counts"]["light-emitter-radius-derived"], json!(1));
}
