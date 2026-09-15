//! Les tests des deux contrats, et d'eux seuls : ce que le routeur choisit, ce qu'il refuse, et ce
//! que le registre d'images sait lire. Le comportement de chaque format se prouve dans sa fixture.
use super::*;
use std::{fs, path::PathBuf};

mod dds;
mod exr;
mod hdr;
mod image_registry;
mod png;
mod router;
mod tga;
mod tiff;
mod webp;

/// Les pixels d'un pilote qui rend du RGBA8. Le contrat a deux sorties : un test qui attend la
/// première le dit, plutôt que de laisser un `let` irréfutable le supposer.
fn rgba8(decoded: image::DecodedImage) -> ::image::RgbaImage {
    match decoded {
        image::DecodedImage::Rgba8(pixels) => pixels,
        image::DecodedImage::RgbaF32 { .. } => panic!("ce pilote doit rendre du RGBA8"),
    }
}

/// Les valeurs d'un pilote qui rend du flottant, avec les dimensions qu'il annonce.
fn rgba_f32(decoded: image::DecodedImage) -> (u32, u32, Vec<f32>) {
    match decoded {
        image::DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => (width, height, data),
        image::DecodedImage::Rgba8(_) => panic!("ce pilote doit rendre du flottant"),
    }
}

/// Les octets d'un fichier réel du corpus, rangé dans `fixtures/<dossier>/`.
fn fixture(folder: &str, name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(folder)
        .join(name);
    fs::read(path).unwrap_or_else(|error| panic!("{folder}/{name}: {error}"))
}

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-plugins-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}
