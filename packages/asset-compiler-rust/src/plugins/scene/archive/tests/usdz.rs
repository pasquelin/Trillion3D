//! The `.usdz` container facing its first entry, which the specification names the root layer.
use super::*;
use crate::plugins::scene::usdz::{ROOT_LAYER, USDZ};

/// A text USD layer of a single triangle: enough that a scene is not empty.
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

/// The same triangle written as OBJ: a scene for the router, never a package root layer.
const OBJ: &[u8] = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

/// The inner driver the container published on the report.
fn inner(run: &Outcome) -> String {
    run.reports
        .iter()
        .find(|report| report["step"] == "routed")
        .map(|report| report["chain"][1]["name"].to_string())
        .unwrap_or_default()
}

// Behaviour 6: the package's first entry is its root layer. A package that does not hold one
// there is refused under its own name, whatever the following entries hold — an OBJ in a `.usdz`
// is not the package's scene.
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

// Behaviour 6: entries that follow the root layer are resources, never candidate scenes. A
// second layer and an OBJ placed beside it therefore make the package neither ambiguous nor
// mute: it is the first entry that ships the scene.
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
    assert_eq!(run.code, "accepted");
    assert_eq!(inner(&run), "\"usd\"", "the root layer ships the scene");
    cleanup(run.dir);
}
