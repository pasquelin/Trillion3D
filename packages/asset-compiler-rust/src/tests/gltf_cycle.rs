//! A09 : un cycle dans la hiérarchie de nœuds glTF. Le parcours des matrices monde partait des
//! seuls nœuds sans père ; un cycle fermé n'en a aucun, il n'était donc jamais parcouru — et la
//! scène partait publiée, son cycle intact, prête à faire tourner sans fin le parcours du
//! consommateur. Un nœud orphelin, lui, reste une scène juste : il a un père nulle part, pas un
//! père en boucle.
use super::*;

/// Compile la fixture dont les nœuds sont ceux du cas, et rend le code de refus, ou `None` quand la
/// compilation aboutit.
fn refusal(tag: &str, gltf_nodes: Value, scenes: Option<Value>) -> Option<String> {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["nodes"] = gltf_nodes;
    if let Some(scenes) = scenes {
        gltf["scenes"] = scenes;
    }
    write_gltf(&options, &gltf, None);
    let outcome = compile(&options, |_| {})
        .err()
        .map(|error| format!("{tag}:{}", error.code));
    let _ = fs::remove_dir_all(&root);
    outcome
}

// Constat A09 : un nœud qui se déclare son propre enfant, et deux nœuds qui se déclarent enfants
// l'un de l'autre, sont des hiérarchies impossibles. Elles sont refusées avant publication, par le
// même code que toute autre contradiction du document.
#[test]
fn un_cycle_de_noeuds_est_refuse_avant_publication() {
    assert_eq!(
        refusal("auto", json!([{"mesh":0,"children":[0]},{"mesh":0}]), None),
        Some("auto:INVALID_GLTF".into()),
        "un nœud son propre enfant ferme un cycle"
    );
    assert_eq!(
        refusal(
            "paire",
            json!([{"mesh":0,"children":[1]},{"mesh":0,"children":[0]}]),
            None
        ),
        Some("paire:INVALID_GLTF".into()),
        "deux nœuds enfants l'un de l'autre ferment un cycle"
    );
    // Le cycle est refusé même quand la scène rendue ne le nomme pas : ce qui est publié porte
    // toute la hiérarchie, pas seulement ce que la scène atteint.
    assert_eq!(
        refusal(
            "hors-scene",
            json!([{"mesh":0},{"mesh":0,"children":[2]},{"mesh":0,"children":[1]}]),
            Some(json!([{"nodes":[0]}]))
        ),
        Some("hors-scene:INVALID_GLTF".into()),
        "un cycle qu'aucune scène n'atteint reste un cycle"
    );
}

// L'autre bout : un nœud sans père qu'aucune scène ne nomme n'est pas un cycle. Il est ignoré,
// comme il l'a toujours été, et la scène compile.
#[test]
fn un_noeud_orphelin_reste_accepte() {
    assert_eq!(
        refusal(
            "orphelin",
            json!([{"mesh":0},{"mesh":0}]),
            Some(json!([{"nodes":[0]}]))
        ),
        None,
        "un nœud hors de la scène rendue n'est pas une hiérarchie impossible"
    );
}
