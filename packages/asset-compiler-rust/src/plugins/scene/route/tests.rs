//! Ce que le routeur reconnaît dans un dossier, et ce qu'il laisse de côté.
use super::*;

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-route-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("dossier de test");
    dir
}

/// Le nom du pilote que le routeur retient pour cette source.
fn routed(source: &Path) -> &'static str {
    match route(source).unwrap_or_else(|error| panic!("{}: {error}", source.display())) {
        Routed::Driver(plugin, _) => plugin.name(),
        Routed::Manifest => "manifest",
    }
}

// Comportement 3 : un sous-dossier dont le nom porte une extension de format n'est pas un fichier
// de ce format. Le routeur route sur les fichiers ordinaires du dossier ; un dossier nommé
// `textures.fbx` est une ressource, pas une source concurrente, et la scène qui l'accompagne est
// routée sans ambiguïté.
#[test]
fn a_subdirectory_whose_name_carries_an_extension_is_not_a_source() {
    let dir = scratch("dossier-a-extension");
    fs::write(dir.join("scene.gltf"), b"{}").expect("scène");
    fs::create_dir_all(dir.join("textures.fbx")).expect("sous-dossier");
    assert_eq!(routed(&dir), "gltf");
    fs::remove_dir_all(&dir).expect("nettoyage");
}

// Comportement 3 : un dossier qui ne porte que des sous-dossiers à nom de format ne porte aucune
// source, et le routeur le dit sous ce nom plutôt que d'en revendiquer un.
#[test]
fn a_directory_holding_only_named_subdirectories_carries_no_source() {
    let dir = scratch("dossiers-seuls");
    for name in ["textures.fbx", "cache.obj"] {
        fs::create_dir_all(dir.join(name)).expect("sous-dossier");
    }
    let code = route(&dir).err().expect("aucune source ici").code;
    assert_eq!(code, "SOURCE_FORMAT_UNKNOWN");
    fs::remove_dir_all(&dir).expect("nettoyage");
}
