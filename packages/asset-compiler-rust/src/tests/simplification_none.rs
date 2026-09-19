//! A03 — `simplification = none` promet les clusters exacts et rien d'autre. Ce que le DAG construit
//! au-dessus du niveau zéro n'est pas une optimisation : c'est une géométrie que la source n'a pas.
use super::*;

/// Le DAG de la même grille, compilée dans un mode donné : profondeur, triangles des racines, et
/// nombre de triangles portés par le niveau zéro.
fn dag_of(mode: &str) -> (u64, usize, u64) {
    let (root, mut options) = grid_fixture_displaced(64, 64, 3.0);
    options.simplification = mode.into();
    let result = compile(&options, |_| {}).expect("compile");
    assert_eq!(
        result["simplification"],
        json!(mode != "none"),
        "le manifeste annonce le mode demandé"
    );
    let primitive = &result["primitives"][0];
    let depth = primitive["dag"]["depth"].as_u64().expect("profondeur");
    let pages = primitive["pages"].as_array().expect("pages");
    let racines: usize = pages
        .iter()
        .filter(|page| page["parentError"].is_null())
        .map(|page| page["count"].as_u64().expect("count") as usize / 3)
        .sum();
    let niveau_zero: u64 = pages
        .iter()
        .filter(|page| page["level"] == json!(0))
        .map(|page| page["count"].as_u64().expect("count") / 3)
        .sum();
    fs::remove_dir_all(root).expect("nettoyage");
    (depth, racines, niveau_zero)
}

// Comportement : en `none`, le DAG tient sur son seul niveau zéro, qui couvre exactement les
// triangles de la source. Aucun remplacement simplifié n'est écrit, donc aucune racine grossière.
#[test]
fn simplification_none_ne_construit_aucun_niveau_grossier() {
    let (depth, racines, niveau_zero) = dag_of("none");
    assert_eq!(depth, 0, "un seul niveau : les clusters exacts");
    assert_eq!(niveau_zero, 8192, "le niveau zéro couvre toute la source");
    assert_eq!(
        racines, 8192,
        "les clusters exacts sont les racines : rien ne les remplace"
    );
}

// Comportement : `qem-endpoints` garde le DAG qu'il construisait — même profondeur, même racine.
#[test]
fn simplification_qem_endpoints_garde_son_dag() {
    let (depth, racines, niveau_zero) = dag_of("qem-endpoints");
    assert_eq!(depth, 6, "profondeur inchangée");
    assert_eq!(niveau_zero, 8192, "le niveau zéro couvre toute la source");
    assert_eq!(racines, 127, "racine inchangée");
}
