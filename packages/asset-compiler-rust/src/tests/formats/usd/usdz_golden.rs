//! `usdz` driver golden test: container must not change packaged scene. Package
//! carries same binary layer as `usd/corpus/usdc` fixture, golden compares both
//! compilations before comparing first to `expected.json`. Fixes driver
//! refusals: compressed package, package without USD layer, package carrying two.
use super::*;

const CASE: &str = "A compliant USDZ package — entries stored as-is, payloads aligned on sixty-four bytes — carrying a usdc layer and its texture in a subfolder.";
const RULE: &str = "A container changes nothing of the scene it packs: the package is extracted under the cache and the scene that comes out is exactly that of the same layer read outside the package. The root layer is the first entry of the package, never a layer sought among the others: those are resources. A badly laid-out package or one that does not open on a USD layer is refused by its code, never half-extracted.";

// Behavior 41: scene read through USDZ package equals scene read outside
// package, two driver chain recorded, trapped packages refused by code,
// package carrying two layers delivers first entry.
#[test]
fn a_packaged_scene_compiles_to_the_same_thing_as_the_layer_outside_the_package() {
    let dir = golden_dir("usdz");
    let inside = compile_golden_source(&dir.join("scene.usdz"), "usdz-paquet");
    let outside = compile_golden_source(
        &golden_dir("usd")
            .join("corpus")
            .join("usdc")
            .join("scene.usdc"),
        "usdz-hors-paquet",
    );
    assert_eq!(
        inside.prepared("usd").1,
        outside.prepared("usd").1,
        "the layer extracted from the package diverges from the same layer outside the package"
    );
    assert_eq!(
        hash(&inside.binary),
        hash(&outside.binary),
        "the package and the bare layer do not compile the same sidecar"
    );
    assert_eq!(
        digest(&dir, &inside),
        golden_expected(&dir),
        "fixture usdz: compiled output diverges from expected.json"
    );
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_usdz() {
    let dir = golden_dir("usdz");
    let run = compile_golden_source(&dir.join("scene.usdz"), "usdz-paquet");
    write_expected(&dir, digest(&dir, &run), CASE, RULE);
}

/// Golden fixes: retained driver, published report chain, refusal codes of
/// trapped packages, scene itself. Cache key omitted: carries fingerprint
/// of entire compiler implementation, unrelated change would shift.
fn digest(dir: &Path, run: &GoldenRun) -> Value {
    json!({
          "scenePlugin": run.result["scenePlugin"],
          "chain": chain_report(run),
          "refus": {
            "compressee": refused_golden_source(&dir.join("compressee.usdz"), "usdz-compressee"),
            "sansScene": refused_golden_source(&dir.join("sans-scene.usdz"), "usdz-sans-scene"),
          },
    // Two layers at root: first carries triangle, second quad.
    // Triangle count tells which package delivered, without guessing.
          "deuxCouchesTriangles":
            compile_golden_source(&dir.join("deux-scenes.usdz"), "usdz-deux-scenes").result["sourceTriangles"],
          "scene": compiled_identity(run, json!({})),
        })
}
