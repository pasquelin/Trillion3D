//! Ce que seul l'intérieur du pilote peut prouver : le nom qu'un asset du projet porte dans la
//! scène intermédiaire. Ce que le pilote produit d'un vrai projet se prouve dans `src/tests/`.
use super::*;

/// Un nom de fichier légal sur le disque et interdit tel quel dans une URI.
const AWKWARD: &str = "co%lor #1 rouge.png";
/// Le GUID que le `.meta` de cette image déclare.
const GUID: &str = "00000000000000000000000000000001";

// Comportement : une texture du projet est nommée par une URI, pas par son chemin. `%`, `#` et
// l'espace s'échappent, sinon le moteur demanderait un autre fichier, ou rien ; et ce qui est écrit
// se redécode exactement en ce que l'auteur avait nommé.
#[test]
fn a_project_asset_is_named_by_an_escaped_uri() {
    let root = std::env::temp_dir().join(format!(
        "wg-unity-uri-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    let assets = root.join("Assets").join("Textures");
    fs::create_dir_all(&assets).expect("dossier");
    let image = assets.join(AWKWARD);
    fs::write(&image, b"\x89PNG\r\n\x1a\n").expect("image");
    fs::write(
        project::meta_of(&image),
        format!("fileFormatVersion: 2\nguid: {GUID}\n"),
    )
    .expect("meta");
    let source = root.join("Assets");
    let project = Project::index(&source, &source, &AtomicBool::new(false)).expect("projet");
    let asset = project.asset(GUID).expect("l'image est indexée");
    let uri = project
        .relative_uri(asset)
        .expect("elle est sous la racine");
    assert_eq!(uri, "Textures/co%25lor%20%231%20rouge.png");
    assert_eq!(
        crate::uri::decode(&uri).as_deref(),
        Some(format!("Textures/{AWKWARD}").as_str())
    );
    fs::remove_dir_all(&root).expect("nettoyage");
}
