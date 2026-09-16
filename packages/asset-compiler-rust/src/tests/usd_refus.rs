//! Les refus durs du pilote `usd` : ce qui ne laisse rien à compiler, et ce que le compilateur
//! refuse de deviner. Ce qui est seulement compté au rapport est dans `usd_rapport.rs`.
use super::*;
use crate::plugins::scene::SceneRequest;
use usd_driver::{plugin, temp_dir, wrap, QUAD};

// Comportement 39 : un maillage dont les comptes de faces ne tombent pas sur ses indices n'est pas
// interprété, et une couche qui n'en porte pas d'autre est refusée par `IMPORT_EMPTY`.
#[test]
fn a_mesh_whose_counts_contradict_its_indices_is_refused_by_name() {
    let mesh = r#"
    def Mesh "Faux"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0)]
        uniform token subdivisionScheme = "none"
    }
"#;
    let dir = temp_dir("invalide");
    let source = dir.join("scene.usda");
    fs::write(&source, wrap("", mesh)).expect("couche");
    assert_eq!(
        refused_golden_source(&source, "usd-invalide"),
        "IMPORT_EMPTY"
    );
    fs::remove_dir_all(&dir).ok();
}

// Comportement 40 : un dossier qui porte deux couches USD est une ambiguïté — le compilateur ne
// choisit pas la couche racine à la place de l'appelant.
#[test]
fn a_directory_carrying_two_layers_is_refused_as_ambiguous() {
    let dir = temp_dir("deux-couches");
    for name in ["a.usda", "b.usda"] {
        fs::write(dir.join(name), wrap("", QUAD)).expect("couche");
    }
    assert_eq!(
        refused_golden_source(&dir, "usd-deux-couches"),
        "SOURCE_FORMAT_AMBIGUOUS"
    );
    fs::remove_dir_all(&dir).ok();
}

// Comportement : le jeton d'annulation est relu **pendant** la conversion, le découpage des faces
// compris — c'est le découpeur lui-même qui le porte —, et la couche entière est refusée par son
// nom plutôt que servie à moitié.
#[test]
fn a_cancelled_layer_is_refused_by_name_and_writes_nothing() {
    let dir = temp_dir("annulation");
    let source = dir.join("scene.usda");
    fs::write(&source, wrap("", QUAD)).expect("couche");
    let cache = dir.join("cache");
    let refused = plugin("usd").prepare(&SceneRequest {
        source: &source,
        inputs: std::slice::from_ref(&source),
        cache: &cache,
        cancelled: &AtomicBool::new(true),
        progress: &|_| {},
    });
    let code = match refused {
        Err(error) => error.code,
        Ok(_) => panic!("une conversion annulée ne rend pas de scène"),
    };
    assert_eq!(code, "CANCELLED");
    fs::remove_dir_all(&dir).ok();
}
