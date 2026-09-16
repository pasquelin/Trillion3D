//! Les tests des deux contrats, et d'eux seuls : ce que le routeur choisit, ce qu'il refuse, et ce
//! que le registre d'images sait lire. Le comportement de chaque format se prouve dans sa fixture.
use super::*;
use std::{fs, path::PathBuf};

mod bmp;
mod dds;
mod exr;
mod gif;
mod hdr;
mod image_registry;
mod ktx2;
mod png;
mod psd;
mod router;
mod tga;
mod tiff;
mod webp;

/// Les pixels d'un pilote qui rend du RGBA8. Le contrat a deux sorties : un test qui attend la
/// première le dit, plutôt que de laisser un `let` irréfutable le supposer.
fn rgba8(decoded: image::ImageDecoded) -> ::image::RgbaImage {
    match decoded.image {
        image::DecodedImage::Rgba8(pixels) => pixels,
        image::DecodedImage::RgbaF32 { .. } => panic!("ce pilote doit rendre du RGBA8"),
    }
}

/// Ce qu'un pilote a déclaré autour des pixels : sa fonction de transfert et les raisons nommées
/// de ce que le fichier portait sans que la sortie sache le porter, dans l'ordre où il les a posées.
fn declared(pilote: &str, name: &str, max_alloc: u64) -> (image::Transfer, Vec<&'static str>) {
    let bytes = fixture(pilote, name);
    let decoded =
        image::decode(&bytes, max_alloc).unwrap_or_else(|error| panic!("{name}: {error}"));
    (decoded.transfer, decoded.notes)
}

/// L'image RGBA8 que le registre rend pour une fixture de `fixtures/<pilote>/` : ce pilote la
/// revendique par ses octets, et elle a les dimensions attendues.
fn decoded_rgba8(pilote: &str, name: &str, max_alloc: u64, size: (u32, u32)) -> ::image::RgbaImage {
    let bytes = fixture(pilote, name);
    let claimed = image::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(claimed.name(), pilote, "{name}");
    let decoded =
        rgba8(image::decode(&bytes, max_alloc).unwrap_or_else(|error| panic!("{name}: {error}")));
    assert_eq!(decoded.dimensions(), size, "{name}");
    decoded
}

/// Ce qu'un pilote revendique par l'extension : chaque écriture le désigne, sous son type MIME.
fn assert_claims(pilote: &str, mime: &str, extensions: &[&str]) {
    for extension in extensions {
        let path = PathBuf::from(format!("albedo.{extension}"));
        let claimed = image::by_extension(&path).expect("revendiqué");
        assert_eq!(claimed.name(), pilote, "{extension}");
        assert_eq!(claimed.mime(), mime, "{extension}");
    }
}

/// Les refus nommés d'un pilote : chaque fixture reste revendiquée par ses octets, puis ressort
/// en raison de rapport, jamais en panique.
fn assert_refusals(pilote: &str, max_alloc: u64, cases: &[(&str, &str)]) {
    for (name, reason) in cases {
        let bytes = fixture(pilote, name);
        assert_eq!(
            image::by_head(&bytes).map(|claimed| claimed.name()),
            Some(pilote),
            "{name}"
        );
        assert_eq!(
            image::decode(&bytes, max_alloc).err(),
            Some(*reason),
            "{name}"
        );
    }
}

/// Les valeurs d'un pilote qui rend du flottant, avec les dimensions qu'il annonce.
fn rgba_f32(decoded: image::ImageDecoded) -> (u32, u32, Vec<f32>) {
    match decoded.image {
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
