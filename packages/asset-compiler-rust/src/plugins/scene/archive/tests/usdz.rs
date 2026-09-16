//! Le conteneur `.usdz` devant sa première entrée, que la spécification nomme la couche racine.
use super::*;
use crate::plugins::scene::usdz::{ROOT_LAYER, USDZ};

/// Une couche USD texte d'un seul triangle : de quoi qu'une scène ne soit pas vide.
const LAYER: &[u8] = br#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root"
{
    def Mesh "Triangle"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#;

/// Le même triangle écrit en OBJ : une scène pour le routeur, jamais une couche racine de paquet.
const OBJ: &[u8] = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

/// Le pilote interne que le conteneur a publié au rapport.
fn inner(run: &Outcome) -> String {
    run.reports
        .iter()
        .find(|report| report["step"] == "routed")
        .map(|report| report["chain"][1]["name"].to_string())
        .unwrap_or_default()
}

// Comportement 6 : la première entrée du paquet est sa couche racine. Un paquet qui n'en porte pas
// une là est refusé sous son propre nom, quoi que portent les entrées suivantes — un OBJ dans un
// `.usdz` n'est pas la scène du paquet.
#[test]
fn a_usdz_whose_first_entry_is_not_a_usd_layer_is_refused_by_name() {
    for entries in [
        vec![Entry::stored("scene.obj", OBJ)],
        vec![
            Entry::stored("textures/checker.png", b"\x89PNG\r\n\x1a\n"),
            Entry::stored("scene.usda", LAYER),
        ],
    ] {
        let run = outcome(
            "usdz-sans-couche",
            &USDZ,
            "paquet.usdz",
            &zip_bytes(&entries, true),
        );
        assert_eq!(run.code, ROOT_LAYER, "{}", entries[0].name);
        assert!(extracted(&run.dir).is_empty(), "{}", entries[0].name);
        cleanup(run.dir);
    }
}

// Comportement 6 : les entrées qui suivent la couche racine sont des ressources, jamais des scènes
// candidates. Une seconde couche et un OBJ posés à côté ne rendent donc le paquet ni ambigu ni
// muet : c'est la première entrée qui livre la scène.
#[test]
fn every_entry_after_the_root_layer_is_a_resource_not_a_scene() {
    let entries = [
        Entry::stored("scene.usda", LAYER),
        Entry::stored("seconde.usda", LAYER),
        Entry::stored("maillage.obj", OBJ),
    ];
    let run = outcome(
        "usdz-ressources",
        &USDZ,
        "paquet.usdz",
        &zip_bytes(&entries, true),
    );
    assert_eq!(run.code, "accepté");
    assert_eq!(inner(&run), "\"usd\"", "la couche racine livre la scène");
    cleanup(run.dir);
}
