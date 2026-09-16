//! Doré du pilote `usdz` : un conteneur ne doit rien changer à la scène qu'il emballe. Le paquet
//! porte la même couche binaire que la fixture `usd/corpus/usdc`, et le doré compare les deux
//! compilations avant de comparer la première à `expected.json`. Il fixe aussi ce que le pilote
//! refuse : un paquet compressé, un paquet sans couche USD, et un paquet qui en porte deux.
use super::*;

const CASE: &str = "Un paquet USDZ conforme — entrées stockées telles quelles, charges alignées sur soixante-quatre octets — portant une couche usdc et sa texture en sous-dossier.";
const RULE: &str = "Un conteneur ne change rien à la scène qu'il emballe : le paquet est extrait sous le cache et la scène qui en sort est exactement celle de la même couche lue hors paquet. La couche racine est la première entrée du paquet, jamais une couche cherchée parmi les autres : celles-là sont des ressources. Un paquet mal disposé ou qui n'ouvre pas sur une couche USD est refusé par son code, jamais extrait à moitié.";

// Comportement 41 : une scène lue à travers son paquet USDZ est exactement la scène lue hors
// paquet, la chaîne des deux pilotes est consignée, les paquets piégés sont refusés par leur code,
// et un paquet qui porte deux couches livre celle de sa première entrée.
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
        "la couche extraite du paquet diverge de la même couche hors paquet"
    );
    assert_eq!(
        hash(&inside.binary),
        hash(&outside.binary),
        "le paquet et la couche nue ne compilent pas le même sidecar"
    );
    assert_eq!(
        digest(&dir, &inside),
        golden_expected(&dir),
        "fixture usdz : la sortie compilée diverge de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_usdz() {
    let dir = golden_dir("usdz");
    let run = compile_golden_source(&dir.join("scene.usdz"), "usdz-paquet");
    write_expected(&dir, digest(&dir, &run), CASE, RULE);
}

/// Ce que la dorée fixe : le pilote retenu, la chaîne publiée au rapport, les codes de refus des
/// paquets piégés, et la scène elle-même. La clé de cache n'y figure pas : elle tient l'empreinte
/// de toute l'implémentation du compilateur, qu'un changement sans rapport déplacerait.
fn digest(dir: &Path, run: &GoldenRun) -> Value {
    json!({
      "scenePlugin": run.result["scenePlugin"],
      "chain": chain_report(run),
      "refus": {
        "compressee": refused_golden_source(&dir.join("compressee.usdz"), "usdz-compressee"),
        "sansScene": refused_golden_source(&dir.join("sans-scene.usdz"), "usdz-sans-scene"),
      },
      // Deux couches à la racine : la première porte un triangle, la seconde un quadrilatère. Le
      // compte de triangles dit donc laquelle le paquet a livrée, sans rien deviner.
      "deuxCouchesTriangles":
        compile_golden_source(&dir.join("deux-scenes.usdz"), "usdz-deux-scenes").result["sourceTriangles"],
      "scene": {
        "formatVersion": run.result["formatVersion"],
        "manifestBinaryVersion": run.slim["binary"]["version"],
        "sidecarSha256": hash(&run.binary),
        "primitives": run.result["primitives"].as_array().expect("primitives").len(),
        "selectedNodes": run.result["selectedNodes"],
        "totalNodes": run.result["totalNodes"],
        "selectedTriangles": run.result["selectedTriangles"],
        "sourceTriangles": run.result["sourceTriangles"],
      },
    })
}

/// La chaîne `usdz` → pilote interne, telle que le conteneur l'a publiée au rapport.
fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("le conteneur publie la chaîne des pilotes")
}
