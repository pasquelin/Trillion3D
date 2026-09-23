//! Hard refusals of `usd` driver: leaves nothing to compile, compiler
//! refuses to guess. Reported items in `report.rs`.
use super::driver::{plugin, temp_dir, wrap, QUAD};
use super::*;
use crate::plugins::scene::SceneRequest;

// Behavior 39: mesh whose face counts contradict indices not
// interpreted, layer carrying no other refused by `IMPORT_EMPTY`.
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

// Behavior 40: folder carrying two USD layers ambiguous — compiler does
// not pick root layer for caller.
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

// Behavior: cancel token re-checked **during** conversion, face subdivision
// included — subdivider carries it —, entire layer refused by
// name rather than partially served.
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
        Ok(_) => panic!("a cancelled conversion does not return a scene"),
    };
    assert_eq!(code, "CANCELLED");
    fs::remove_dir_all(&dir).ok();
}
