use super::*;
use scene::{route, Routed};

/// Le nom du pilote retenu pour cette source, ou le code d'erreur du refus.
fn routed(path: &std::path::Path) -> std::result::Result<String, (&'static str, String)> {
    match route(path) {
        Ok(Routed::Manifest) => Ok("manifest".to_string()),
        Ok(Routed::Driver(plugin, _)) => Ok(plugin.name().to_string()),
        Err(error) => Err((error.code, error.message)),
    }
}

// Contrat du routeur : une source qu'aucun pilote ne revendique est refusée, et le refus nomme ce
// que ce binaire accepte — sinon l'appelant n'a aucun moyen de savoir quoi exporter.
#[test]
fn an_unknown_source_is_refused_and_the_accepted_formats_are_named() {
    let dir = temp_dir("unknown");
    fs::write(dir.join("scene.sbsar"), b"not a format we read").expect("write");
    let (code, message) = routed(&dir).expect_err("an unknown source is refused");
    assert_eq!(code, "SOURCE_FORMAT_UNKNOWN");
    for expected in ["manifest.json", "gltf", ".glb", "fbx", "obj"] {
        assert!(message.contains(expected), "{message}");
    }
    let file = dir.join("scene.sbsar");
    let (code, _) = routed(&file).expect_err("an unknown file is refused too");
    assert_eq!(code, "SOURCE_FORMAT_UNKNOWN");
    fs::remove_dir_all(dir).expect("cleanup");
}

// Contrat du routeur : deux pilotes servis par le même dossier, c'est une ambiguïté. Le compilateur
// refuse en nommant les deux plutôt que de deviner lequel porte la scène.
#[test]
fn a_source_claimed_by_two_plugins_is_refused_and_both_are_named() {
    let dir = temp_dir("ambiguous");
    fs::write(dir.join("a.obj"), b"v 0 0 0\n").expect("obj");
    fs::write(dir.join("b.fbx"), b"Kaydara FBX Binary  \x00").expect("fbx");
    let (code, message) = routed(&dir).expect_err("an ambiguous source is refused");
    assert_eq!(code, "SOURCE_FORMAT_AMBIGUOUS");
    assert!(
        message.contains("fbx") && message.contains("obj"),
        "{message}"
    );
    fs::remove_dir_all(dir).expect("cleanup");
}

// Contrat du routeur : un format, un pilote. glTF et GLB vont au pilote glTF, en fichier comme en
// dossier ; deux glTF dans le même dossier restent une ambiguïté, celle du pilote lui-même.
#[test]
fn gltf_and_glb_sources_select_the_gltf_plugin() {
    let dir = temp_dir("gltf");
    fs::write(dir.join("mesh.gltf"), b"{}").expect("gltf");
    assert_eq!(routed(&dir).expect("directory"), "gltf");
    assert_eq!(routed(&dir.join("mesh.gltf")).expect("file"), "gltf");
    let glb = temp_dir("glb");
    fs::write(glb.join("mesh.glb"), b"glTF\x02\x00\x00\x00").expect("glb");
    assert_eq!(routed(&glb).expect("glb"), "gltf");
    // Sans extension, l'entête du conteneur suffit à désigner le pilote.
    fs::rename(glb.join("mesh.glb"), glb.join("mesh")).expect("rename");
    assert_eq!(routed(&glb.join("mesh")).expect("headless glb"), "gltf");
    // Deux modèles dans un dossier restent une ambiguïté, tranchée par le pilote lui-même : le
    // routeur lui remet tout ce qu'il revendique, c'est lui qui sait combien il en accepte.
    fs::write(dir.join("other.glb"), b"glTF\x02\x00\x00\x00").expect("second");
    let Routed::Driver(plugin, files) = route(&dir).expect("two models") else {
        panic!("a directory of models routed to the manifest")
    };
    let refusal = plugin.prepare(&scene::SceneRequest {
        source: &dir,
        inputs: &files,
        cache: &dir,
        cancelled: &std::sync::atomic::AtomicBool::new(false),
        progress: &|_| {},
    });
    assert!(
        matches!(refusal, Err(ref error) if error.code == "SOURCE_FORMAT_AMBIGUOUS"),
        "two models in one directory"
    );
    fs::remove_dir_all(dir).expect("cleanup");
    fs::remove_dir_all(glb).expect("cleanup");
}

// Contrat du routeur : FBX et OBJ sont deux pilotes distincts, jamais un pilote « ufbx » commun, et
// un dossier qui porte déjà `manifest.json` ne passe par aucun pilote.
#[test]
fn fbx_obj_and_manifest_sources_each_go_to_their_own_route() {
    let dir = temp_dir("ufbx");
    fs::write(dir.join("a.fbx"), b"Kaydara FBX Binary  \x00").expect("fbx");
    assert_eq!(routed(&dir.join("a.fbx")).expect("fbx file"), "fbx");
    assert_eq!(routed(&dir).expect("fbx directory"), "fbx");
    let obj = temp_dir("obj");
    fs::write(obj.join("a.obj"), b"v 0 0 0\n").expect("obj");
    fs::write(obj.join("a.mtl"), b"newmtl painted\n").expect("mtl");
    match route(&obj).expect("obj directory") {
        Routed::Driver(plugin, files) => {
            assert_eq!(plugin.name(), "obj");
            assert_eq!(files.len(), 1, "le .mtl voisin n'est pas une source");
        }
        Routed::Manifest => panic!("obj directory routed to the manifest"),
    }
    fs::write(obj.join("manifest.json"), b"{}").expect("manifest");
    assert_eq!(routed(&obj).expect("manifest wins"), "manifest");
    fs::remove_dir_all(dir).expect("cleanup");
    fs::remove_dir_all(obj).expect("cleanup");
}
