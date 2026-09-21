//! `zip` driver golden test: container must not change packaged scene. Fixture
//! double — same glTF scene inside archive and outside — golden compares
//! both compilations to each other before comparing to `expected.json`. Fixes
//! driver refusals: archive escaping extraction folder, truncated archive, and
//! empty archive, each by its code.
use super::*;

// Behavior 25: scene read through ZIP equals scene read outside archive,
// two driver chain recorded, three trapped archives refused by name.
#[test]
fn a_zipped_scene_compiles_to_the_same_thing_as_the_scene_outside_the_archive() {
    let dir = golden_dir("zip");
    let inside = compile_golden_source(&dir.join("scene.zip"), "zip-archive");
    let outside = compile_golden_source(&dir.join("hors-archive").join("scene.gltf"), "zip-direct");
    assert_eq!(
        scene_digest(&inside),
        scene_digest(&outside),
        "the scene extracted from the ZIP diverges from the same scene outside the archive"
    );
    assert_eq!(
        archive_digest(&dir, &inside),
        golden_expected(&dir),
        "fixture zip: compiled output diverges from expected.json"
    );
    assert_eq!(
        outside.result["scenePlugin"]["name"], "gltf",
        "outside the archive, it is the glTF driver that answers"
    );
}

/// Golden fixes: retained driver, published report chain, refusal codes
/// trapped archives, scene itself.
fn archive_digest(dir: &Path, run: &GoldenRun) -> Value {
    // Cache key holds fingerprint of entire compiler implementation: proves
    // two compilations equal, not frozen in expectation where an unrelated change
    // would shift it and fail tests.
    let mut scene = scene_digest(run);
    scene.as_object_mut().expect("scene").remove("key");
    json!({
      "scenePlugin": run.result["scenePlugin"],
      "chain": chain_report(run),
      "refus": {
        "sortieDeDossier": refused_golden_source(&dir.join("sortie-de-dossier.zip"), "zip-slip"),
        "tronquee": refused_golden_source(&dir.join("tronquee.zip"), "zip-tronquee"),
        "vide": refused_golden_source(&dir.join("vide.zip"), "zip-vide"),
      },
      "scene": scene,
    })
}

/// Compiled scene identity: cache key holds source manifest fingerprint and
/// binary, sidecar hash holds bytes engine reads, counts say
/// rest. Two compilations rendering identical hash produced same scene — and
/// key being same, second re-reads first's cache. Neither `clusters.json` nor report
/// compared whole: carry durations, not scene properties.
fn scene_digest(run: &GoldenRun) -> Value {
    json!({
      "formatVersion": run.result["formatVersion"],
      "key": run.result["key"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
      "sidecarSha256": hash(&run.binary),
      "primitives": run.result["primitives"].as_array().expect("primitives").len(),
      "selectedNodes": run.result["selectedNodes"],
      "totalNodes": run.result["totalNodes"],
      "selectedTriangles": run.result["selectedTriangles"],
      "sourceTriangles": run.result["sourceTriangles"],
    })
}

/// `zip` -> internal driver chain, as container published in report.
fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("the container publishes the driver chain")
}

#[test]
#[ignore = "writes into fixtures/; rerun by hand, and its diff is re-read"]
fn regenerate_the_zip_fixture() {
    let dir = golden_dir("zip");
    let inside = compile_golden_source(&dir.join("scene.zip"), "zip-archive");
    write_expected(&dir, archive_digest(&dir, &inside), "", "");
}
