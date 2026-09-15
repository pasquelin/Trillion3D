//! Ce que le pilote Unity reconnaît et ce qu'il refuse. La scène dorée, elle, est dans
//! `unity_golden.rs` : ici on ne fixe que les entrées qui ne donnent pas de scène.
use super::*;
use plugins::scene::{route, PreparedScene, Routed, SceneRequest};

/// Passe la source par le routeur puis par le pilote qu'il choisit, comme le compilateur le fait.
fn prepare(source: &Path, cache: &Path) -> std::result::Result<PathBuf, (&'static str, String)> {
    let prepared = match route(source).map_err(|error| (error.code, error.message))? {
        Routed::Driver(plugin, inputs) => {
            assert_eq!(plugin.name(), "unity", "{}", source.display());
            plugin.prepare(&SceneRequest {
                source,
                inputs: &inputs,
                cache,
                cancelled: &AtomicBool::new(false),
                progress: &|_| {},
            })
        }
        Routed::Manifest => panic!("routed to the manifest"),
    };
    match prepared.map_err(|error| (error.code, error.message))? {
        PreparedScene::Converted(directory) => Ok(directory),
        _ => panic!("the unity plugin always converts"),
    }
}

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-unity-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// L'entête que l'éditeur écrit en tête de chaque fichier sérialisé.
const HEAD: &[u8] = b"%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";

// Comportement 26 : un `.unity` tronqué ne porte aucun document. Le pilote le refuse avec un code,
// sans panique ni allocation non bornée — la fixture `limites` est le fichier de 31 octets.
#[test]
fn a_truncated_unity_file_is_refused_with_a_code() {
    let cache = temp_dir("truncated");
    let source = golden_dir("unity/limites").join("truncated.unity");
    let (code, message) = prepare(&source, &cache).expect_err("a truncated scene is refused");
    assert_eq!(code, "IMPORT_ERROR");
    assert!(message.contains("truncated.unity"), "{message}");
    fs::remove_dir_all(cache).expect("cleanup");
}

// Comportement 27 : plusieurs scènes dans un dossier, c'est une ambiguïté. Le pilote les nomme et
// demande qu'on lui en désigne une, plutôt que d'en choisir une à la place de l'appelant.
#[test]
fn several_scenes_in_one_directory_are_refused_and_named() {
    let dir = temp_dir("scenes");
    fs::write(dir.join("Map.unity"), HEAD).expect("first");
    fs::write(dir.join("Other.unity"), HEAD).expect("second");
    let (code, message) = prepare(&dir, &dir).expect_err("two scenes are refused");
    assert_eq!(code, "SOURCE_FORMAT_AMBIGUOUS");
    assert!(
        message.contains("Map.unity") && message.contains("Other.unity"),
        "{message}"
    );
    // Désignée par son fichier, la scène n'est plus ambiguë : elle est vide, ce qui est un autre
    // refus, nommé autrement.
    let (code, _) = prepare(&dir.join("Map.unity"), &dir).expect_err("an empty scene is refused");
    assert_eq!(code, "IMPORT_ERROR");
    fs::remove_dir_all(dir).expect("cleanup");
}

// Comportement 28 : un projet Unity est reconnu au niveau du dossier. Le dossier de la dorée porte
// une scène et un FBX ; sans le désigner, le routeur rend le pilote `unity` et la scène qu'il a
// trouvée, le modèle n'étant qu'une entrée du projet. Un dossier sans scène reste l'affaire des
// pilotes de fichiers : deux formats de modèle côte à côte y restent une ambiguïté.
#[test]
fn a_unity_project_directory_wins_over_the_models_it_carries() {
    let project = golden_dir("unity/cc0-import-project");
    match route(&project).expect("le dossier du projet est revendiqué") {
        Routed::Driver(plugin, inputs) => {
            assert_eq!(plugin.name(), "unity");
            assert_eq!(inputs, vec![project.join("Assets").join("Map.unity")]);
        }
        Routed::Manifest => panic!("routed to the manifest"),
    }
    let dir = temp_dir("modeles");
    fs::write(dir.join("a.fbx"), b"Kaydara FBX Binary  ").expect("fbx");
    fs::write(dir.join("b.obj"), b"v 0 0 0\n").expect("obj");
    let refusal = route(&dir)
        .err()
        .expect("deux formats de modèle sont ambigus");
    assert_eq!(refusal.code, "SOURCE_FORMAT_AMBIGUOUS");
    fs::remove_dir_all(dir).expect("cleanup");
}

// Comportement 29 : un fichier de données Unity dont le nom ne dit rien est reconnu à son entête —
// la directive de tag que l'éditeur écrit en tête de chaque fichier sérialisé.
#[test]
fn a_unity_data_file_is_recognised_by_its_head() {
    let dir = temp_dir("head");
    let file = dir.join("scene-without-extension");
    fs::write(&file, HEAD).expect("write");
    match route(&file).expect("a headed file is claimed") {
        Routed::Driver(plugin, _) => assert_eq!(plugin.name(), "unity"),
        Routed::Manifest => panic!("routed to the manifest"),
    }
    fs::remove_dir_all(dir).expect("cleanup");
}
