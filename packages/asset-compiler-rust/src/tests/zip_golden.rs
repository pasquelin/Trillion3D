//! Doré du pilote `zip` : un conteneur ne doit rien changer à la scène qu'il emballe. La fixture
//! est donc double — la même scène glTF dans son archive et hors d'elle — et le doré compare les
//! deux compilations l'une à l'autre avant de les comparer à `expected.json`. Il fixe aussi ce que
//! le pilote refuse : une archive qui sort de son dossier d'extraction, une archive tronquée et une
//! archive vide, chacune par son code.
use super::*;

// Comportement 25 : une scène lue à travers son ZIP est exactement la scène lue hors archive, la
// chaîne des deux pilotes est consignée, et les trois archives piégées sont refusées par leur nom.
#[test]
fn a_zipped_scene_compiles_to_the_same_thing_as_the_scene_outside_the_archive() {
    let dir = golden_dir("zip");
    let inside = compile_golden_source(&dir.join("scene.zip"), "zip-archive");
    let outside = compile_golden_source(&dir.join("hors-archive").join("scene.gltf"), "zip-direct");
    assert_eq!(
        scene_digest(&inside),
        scene_digest(&outside),
        "la scène extraite du ZIP diverge de la même scène hors archive"
    );
    assert_eq!(
        archive_digest(&dir, &inside),
        golden_expected(&dir),
        "fixture zip : la sortie compilée diverge de expected.json"
    );
    assert_eq!(
        outside.result["scenePlugin"]["name"], "gltf",
        "hors archive, c'est le pilote glTF qui répond"
    );
}

/// Ce que la dorée fixe : le pilote retenu, la chaîne publiée au rapport, les codes de refus des
/// archives piégées, et la scène elle-même.
fn archive_digest(dir: &Path, run: &GoldenRun) -> Value {
    // La clé de cache tient l'empreinte de toute l'implémentation du compilateur : elle prouve que
    // les deux compilations n'en font qu'une, elle ne se fige pas dans un attendu qu'un changement
    // sans rapport ferait rougir.
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

/// L'identité de la scène compilée : la clé de cache tient l'empreinte du manifeste de la source et
/// de son binaire, le condensé du sidecar tient les octets que le moteur lira, les comptes disent le
/// reste. Deux compilations qui rendent ce condensé à l'identique ont produit la même scène — et la
/// clé étant la même, la seconde relit le cache de la première. Ni `clusters.json` ni le rapport ne
/// sont comparés entiers : ils portent des durées, qui ne sont d'aucune scène.
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

/// La chaîne `zip` → pilote interne, telle que le conteneur l'a publiée au rapport.
fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("le conteneur publie la chaîne des pilotes")
}
