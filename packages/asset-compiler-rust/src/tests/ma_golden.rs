//! Doré du pilote `ma`. Une fixture écrite à la main, et les deux refus durs du format.
//!
//! `minuscule/scene.ma` tient une hiérarchie `transform`, un `mesh` à deux quadrilatères dont l'un
//! réutilise l'arête de l'autre à l'envers, deux groupes de faces nuancés séparément, une seconde
//! pose de la même forme par `parent -add`, un `lambert`, un `standardSurface` texturé, une caméra
//! et une commande `python`. Elle fixe ce que le pilote produit, jusqu'aux octets du sidecar, et ce
//! qu'il compte sans le rendre.
use super::*;

const CASE: &str = "Un fichier Maya ASCII : une hiérarchie transform en centimètres, un mesh de deux quadrilatères dont le second réutilise une arête du premier à l'envers, deux instObjGroups d'une face chacun nuancés par deux shadingEngine, une seconde pose de la forme par parent -add, un lambert opaque, un standardSurface métallique translucide à texture de couleur, une caméra, un select sur un nœud absent du fichier et une commande python.";
const RULE: &str = "Le pilote rend les données du fichier et rien d'autre : aucune commande n'est exécutée, les faces sont résolues par leurs arêtes signées puis triangulées en éventail, un groupe de faces devient une primitive à part, les normales absentes sont calculées à plat, lambert et standardSurface vont vers pbrMetallicRoughness, l'unité linéaire est portée par la racine de la scène, et tout ce qui reste est compté par son nom.";

// Comportement : la fixture passe par le compilateur, et sa scène intermédiaire comme sa sortie
// compilée sont comparées à expected.json.
#[test]
fn the_ma_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("ma");
    let run = compile_golden_source(&fixture(&dir), "ma-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture ma : la sortie compilée diverge de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_ma() {
    let dir = golden_dir("ma");
    let run = compile_golden_source(&fixture(&dir), "ma-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

// Comportement : un fichier tronqué avant toute commande garde son entête, donne un document sans
// aucune surface, et c'est cette absence qui est refusée — par son nom, sans rien avoir écrit.
#[test]
fn a_ma_file_truncated_before_its_first_command_is_refused_as_empty() {
    let root = std::env::temp_dir().join(format!("wg-ma-vide-{}", std::process::id()));
    fs::create_dir_all(&root).expect("dossier");
    let file = root.join("truncated.ma");
    fs::write(&file, "//Maya ASCII 2024 scene\n// Orig").expect("fichier");
    assert_eq!(refused_golden_source(&file, "ma-truncated"), "IMPORT_EMPTY");
    let _ = fs::remove_dir_all(&root);
}

// Comportement : un fichier dont la première ligne n'annonce pas un Maya ASCII n'est pas lu, même
// quand son extension l'amène à ce pilote.
#[test]
fn a_file_without_the_maya_header_is_refused_by_name() {
    let root = std::env::temp_dir().join(format!("wg-ma-entete-{}", std::process::id()));
    fs::create_dir_all(&root).expect("dossier");
    let file = root.join("autre.ma");
    fs::write(&file, "createNode transform -n \"X\";\n").expect("fichier");
    assert_eq!(
        refused_golden_source(&file, "ma-header"),
        "ma-file-invalid",
        "un fichier sans entête Maya doit être refusé par son nom"
    );
    let _ = fs::remove_dir_all(&root);
}

/// Le fichier de la fixture minuscule.
fn fixture(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.ma")
}

/// Ce que la dorée fixe : le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds,
/// maillages, matériaux, images, rapport — et la scène compilée qui en sort.
fn digest(run: &GoldenRun) -> Value {
    let (digest, manifest, gltf) = scene_digest(run, "ma");
    let mut out = digest;
    for (field, value) in [
        ("scenePlugin", run.result["scenePlugin"].clone()),
        ("meshes", gltf["meshes"].clone()),
        ("materials", gltf["materials"].clone()),
        ("images", gltf["images"].clone()),
        ("samplers", gltf["samplers"].clone()),
        ("textures", gltf["textures"].clone()),
        ("accessors", gltf["accessors"].clone()),
        ("files", manifest["source"]["files"].clone()),
        ("sidecarSha256", json!(hash(&run.binary))),
        ("selectedNodes", run.result["selectedNodes"].clone()),
        ("sourceTriangles", run.result["sourceTriangles"].clone()),
    ] {
        out[field] = value;
    }
    out
}
