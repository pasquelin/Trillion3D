//! What the router recognises in a directory, and what it leaves aside.
use super::*;
use crate::tests::directories::scratch;

/// Name of the driver the router retains for this source.
fn routed(source: &Path) -> &'static str {
    match route(source).unwrap_or_else(|error| panic!("{}: {error}", source.display())) {
        Routed::Driver(plugin, _) => plugin.name(),
        Routed::Manifest => "manifest",
    }
}

// Behaviour 3: a subdirectory whose name carries a format extension is not a file of that format.
// The router routes on ordinary files in the directory; a folder named `textures.fbx` is a
// resource, not a competing source, and the scene that accompanies it is routed without
// ambiguity.
#[test]
fn a_subdirectory_whose_name_carries_an_extension_is_not_a_source() {
    let dir = scratch("route", "dossier-a-extension");
    fs::write(dir.join("scene.gltf"), b"{}").expect("scene");
    fs::create_dir_all(dir.join("textures.fbx")).expect("subdirectory");
    assert_eq!(routed(&dir), "gltf");
    fs::remove_dir_all(&dir).expect("cleanup");
}

// Behaviour 3: a directory that holds only subdirectories named like formats carries no source,
// and the router says so under that name rather than claiming one.
#[test]
fn a_directory_holding_only_named_subdirectories_carries_no_source() {
    let dir = scratch("route", "dossiers-seuls");
    for name in ["textures.fbx", "cache.obj"] {
        fs::create_dir_all(dir.join(name)).expect("subdirectory");
    }
    let code = route(&dir).err().expect("no source here").code;
    assert_eq!(code, "SOURCE_FORMAT_UNKNOWN");
    fs::remove_dir_all(&dir).expect("cleanup");
}
