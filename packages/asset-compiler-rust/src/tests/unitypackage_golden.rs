//! Doré du pilote `unitypackage` : un conteneur ne doit rien changer au projet qu'il emballe. La
//! fixture est donc double — le même projet Unity CC0 **dans** son paquet et **à plat** hors de lui
//! — et le doré compare les deux compilations l'une à l'autre avant de comparer la première à
//! `expected.json`. Il fixe aussi ce que le pilote refuse : un `pathname` qui sort du dossier
//! d'extraction, un paquet tronqué et un paquet sans aucune entrée, chacun par son code.
use super::*;

// Comportement 25 : un projet Unity lu à travers son `.unitypackage` est exactement le même projet
// lu à plat, la chaîne des deux pilotes est consignée, et les trois paquets piégés sont refusés.
#[test]
fn a_packaged_unity_project_compiles_to_the_same_scene_as_the_project_on_disk() {
    let dir = golden_dir("unitypackage");
    let inside = compile_golden_source(&dir.join("test.unitypackage"), "unitypackage-paquet");
    let outside =
        compile_golden_source(&dir.join("hors-paquet").join("Assets"), "unitypackage-plat");
    assert_eq!(
        scene_digest(&inside),
        scene_digest(&outside),
        "le projet reconstruit depuis le paquet diverge du même projet à plat"
    );
    assert_eq!(
        package_digest(&dir, &inside),
        golden_expected(&dir),
        "fixture unitypackage : la sortie compilée diverge de expected.json"
    );
    assert_eq!(
        outside.result["scenePlugin"]["name"], "unity",
        "hors paquet, c'est le pilote Unity qui répond"
    );
}

/// Ce que la dorée fixe : le pilote retenu, la chaîne publiée au rapport, les codes de refus des
/// paquets piégés, et la scène elle-même.
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

/// L'identité du projet compilé. `files` est la matière même de la clé de la scène intermédiaire :
/// le nom, la taille et l'empreinte de chaque fichier de données lu, et la clé d'import de chaque
/// modèle — rien qui dépende de l'endroit où le projet se trouve. Deux compilations qui rendent ce
/// condensé à l'identique ont lu les mêmes octets et produit la même scène. La clé de compilation,
/// elle, n'y figure pas : le manifeste d'une scène convertie porte sa durée d'import, donc la clé
/// change d'un passage à l'autre sans que la scène bouge.
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

/// La chaîne `unitypackage` → pilote interne, telle que le conteneur l'a publiée au rapport.
fn chain_report(run: &GoldenRun) -> Value {
    run.reports
        .iter()
        .find(|report| report["phase"] == "archive" && report["step"] == "routed")
        .map(|report| report["chain"].clone())
        .expect("le conteneur publie la chaîne des pilotes")
}
