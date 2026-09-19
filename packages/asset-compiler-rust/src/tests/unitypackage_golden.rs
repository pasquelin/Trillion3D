//! Golden of the `unitypackage` driver: a container must change nothing of the
//! project it packs. The fixture is therefore double — the same CC0 Unity project
//! **inside** its package and **flat** outside it — and the golden compares the
//! two compilations to each other before comparing the first to `expected.json`.
//! It also fixes what the driver refuses: a `pathname` that leaves the extraction
//! folder, a truncated package and a package with no entry, each by its code.
use super::*;

// Behaviour 25: a Unity project read through its `.unitypackage` is exactly the
// same project read flat, the two-driver chain is recorded, and the three trapped
// packages are refused.
#[test]
fn a_packaged_unity_project_compiles_to_the_same_scene_as_the_project_on_disk() {
    let dir = golden_dir("unitypackage");
    let inside = compile_golden_source(&dir.join("test.unitypackage"), "unitypackage-paquet");
    let outside =
        compile_golden_source(&dir.join("hors-paquet").join("Assets"), "unitypackage-plat");
    assert_eq!(
        scene_digest(&inside),
        scene_digest(&outside),
        "the project rebuilt from the package diverges from the same project on disk"
    );
    assert_eq!(
        package_digest(&dir, &inside),
        golden_expected(&dir),
        "fixture unitypackage: compiled output diverges from expected.json"
    );
    assert_eq!(
        outside.result["scenePlugin"]["name"], "unity",
        "outside the package, it is the Unity driver that answers"
    );
}

/// What the golden fixes: the retained driver, the chain published in the report,
/// the refusal codes of the trapped packages, and the scene itself.
fn package_digest(dir: &Path, run: &GoldenRun) -> Value {
    json!({
      "scenePlugin": run.result["scenePlugin"],
      "chain": chain_report(run),
      "refus": {
        "sortieDeDossier": refused_golden_source(&dir.join("sortie-de-dossier.unitypackage"), "up-slip"),
        "tronque": refused_golden_source(&dir.join("tronque.unitypackage"), "up-tronque"),
        "vide": refused_golden_source(&dir.join("vide.unitypackage"), "up-vide"),
      },
      "scene": scene_digest(run),
    })
}

/// Identity of the compiled project. `files` is the very matter of the
/// intermediate-scene key: name, size and fingerprint of each data file read, and
/// the import key of each model — nothing that depends on where the project sits.
/// Two compilations that yield this digest identically have read the same bytes
/// and produced the same scene. The compilation key is not in it: a converted
/// scene's manifest carries its import duration, so the key changes from one run
/// to the next without the scene moving.
fn scene_digest(run: &GoldenRun) -> Value {
    let (manifest, _) = run.prepared("unity");
    json!({
      "formatVersion": run.result["formatVersion"],
      "plugin": manifest["source"]["plugin"],
      "files": manifest["source"]["files"],
      "counts": manifest["source"]["counts"],
      "unsupported": manifest["unsupported"],
      "notes": manifest["notes"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
      "sidecarSha256": hash(&run.binary),
      "primitives": run.result["primitives"].as_array().expect("primitives").len(),
      "selectedNodes": run.result["selectedNodes"],
      "totalNodes": run.result["totalNodes"],
      "selectedTriangles": run.result["selectedTriangles"],
      "sourceTriangles": run.result["sourceTriangles"],
    })
}

/// The `unitypackage` → inner driver chain, as the container published it in the report.
fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("the container publishes the driver chain")
}
