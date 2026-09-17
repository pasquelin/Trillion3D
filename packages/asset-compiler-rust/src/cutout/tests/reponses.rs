//! La lecture des réponses, et ce qu'une réponse change dans la scène.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn dossier(nom: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "web-geometry-decoupes-{nom}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    fs::create_dir_all(&path).expect("dossier");
    path
}

fn ecrire(directory: &Path, sheet: &Value) {
    fs::write(
        directory.join(DECISIONS_FILE),
        serde_json::to_vec(sheet).expect("feuille"),
    )
    .expect("écriture");
}

/// Une scène d'un maillage, d'un matériau en mélange et d'une image embarquée dont les octets sont
/// le binaire lui-même : la feuille se range par l'empreinte de ces octets.
fn scene() -> (Value, Vec<u8>, String) {
    let bin = b"des octets d'image".to_vec();
    let g = json!({"meshes":[{"primitives":[{"material":0}]}],
        "materials":[{"alphaMode":"BLEND","pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}],
        "textures":[{"source":0}],"images":[{"bufferView":0}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":18}]});
    let sha = hash(&bin);
    (g, bin, sha)
}

fn appliquer(g: &mut Value, bin: &[u8], decisions: &Decisions) -> CutoutApplied {
    apply_decisions(g, bin, Path::new("."), &BTreeSet::from([0usize]), decisions)
        .expect("application")
}

// Comportement : sans feuille, rien ne change. Un mélange reste un mélange, et le rapport le dit.
#[test]
fn sans_feuille_le_melange_reste_du_melange() {
    let directory = dossier("vide");
    let decisions = load_decisions(&directory, &directory).expect("lecture");
    let (mut g, bin, _) = scene();
    let applied = appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.report(&decisions)["candidateTextures"], json!(1));
    assert!(
        applied.applied.is_empty(),
        "rien n'est appliqué sans réponse"
    );
}

// Comportement : une réponse « découpe » passe le matériau en masqué, au seuil de glTF, et le
// rapport nomme la liaison changée.
#[test]
fn une_reponse_decoupe_passe_le_materiau_en_masque() {
    let directory = dossier("decoupe");
    let (mut g, bin, sha) = scene();
    ecrire(
        &directory,
        &json!({"version":1,"textures":{&sha:{"cutout":true}}}),
    );
    let decisions = load_decisions(&directory, &directory).expect("lecture");
    let applied = appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("MASK"));
    assert_eq!(g["materials"][0]["alphaCutoff"], json!(0.5));
    assert_eq!(applied.applied[0]["texture"], json!(0));
    assert_eq!(applied.to_measure(), BTreeSet::from([0usize]));
}

// Comportement : une réponse « vitre », et une texture jamais tranchée, laissent la scène intacte.
#[test]
fn une_reponse_vitre_laisse_la_scene_intacte() {
    let directory = dossier("vitre");
    let (mut g, bin, sha) = scene();
    ecrire(
        &directory,
        &json!({"version":1,"textures":{&sha:{"cutout":false}}}),
    );
    let decisions = load_decisions(&directory, &directory).expect("lecture");
    appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
}

// Comportement : un matériau qui transmet la lumière est refusé malgré la réponse — son épaisseur
// n'est pas une découpe —, et le refus est nommé plutôt que tu.
#[test]
fn une_transmission_est_refusee_malgre_la_reponse() {
    let directory = dossier("transmission");
    let (mut g, bin, sha) = scene();
    g["materials"][0]["extensions"] =
        json!({"KHR_materials_transmission":{"transmissionFactor":0.8}});
    ecrire(
        &directory,
        &json!({"version":1,"textures":{&sha:{"cutout":true}}}),
    );
    let decisions = load_decisions(&directory, &directory).expect("lecture");
    let applied = appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.refused[0]["reason"], json!("transmission"));
}

// Comportement : un matériau dont le facteur alpha est déjà partiel est refusé de même — son
// opacité ne vient pas de la texture, et la découper ne la rendrait pas.
#[test]
fn un_facteur_alpha_partiel_est_refuse() {
    let directory = dossier("facteur");
    let (mut g, bin, sha) = scene();
    g["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"] = json!([1.0, 1.0, 1.0, 0.4]);
    ecrire(
        &directory,
        &json!({"version":1,"textures":{&sha:{"cutout":true}}}),
    );
    let decisions = load_decisions(&directory, &directory).expect("lecture");
    let applied = appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.refused[0]["reason"], json!("alpha-factor"));
}

// Comportement : une réponse nulle est une texture non tranchée, pas une erreur ; une version
// inconnue et une réponse d'un autre type sont refusées, parce qu'une réponse mal lue changerait
// l'image sans que personne l'ait demandé.
#[test]
fn une_feuille_illisible_est_refusee_et_une_reponse_nulle_attend() {
    let directory = dossier("formes");
    ecrire(
        &directory,
        &json!({"version":1,"textures":{"abc":{"cutout":Value::Null}}}),
    );
    assert_eq!(
        load_decisions(&directory, &directory)
            .expect("lecture")
            .verdict("abc"),
        None
    );
    ecrire(&directory, &json!({"version":99,"textures":{}}));
    assert!(load_decisions(&directory, &directory).is_err());
    ecrire(
        &directory,
        &json!({"version":1,"textures":{"abc":{"cutout":"oui"}}}),
    );
    assert!(load_decisions(&directory, &directory).is_err());
}

// Comportement : une feuille livrée à côté de la source amorce la première compilation, quand le
// modèle compilé n'en a pas encore.
#[test]
fn une_feuille_livree_avec_la_source_amorce() {
    let (cache, source) = (dossier("cache"), dossier("source"));
    ecrire(
        &source,
        &json!({"version":1,"textures":{"abc":{"cutout":true}}}),
    );
    assert_eq!(
        load_decisions(&cache, &source)
            .expect("lecture")
            .verdict("abc"),
        Some(true)
    );
}
