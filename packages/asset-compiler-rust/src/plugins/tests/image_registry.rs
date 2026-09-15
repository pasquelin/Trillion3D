use super::super::{descriptor, fingerprint, image as registry, scene};
use ::image::{ImageFormat, Rgba, RgbaImage};
use std::path::{Path, PathBuf};

const MAX_ALLOC: u64 = 64 * 1024 * 1024;

/// Une image de quatre pixels, encodée dans le format demandé.
fn encoded(format: ImageFormat) -> Vec<u8> {
    let mut pixels = RgbaImage::new(2, 2);
    pixels.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
    pixels.put_pixel(1, 1, Rgba([0, 0, 255, 255]));
    // JPEG n'a pas de canal alpha : c'est le format qui impose la conversion, pas le contrat.
    let pixels = ::image::DynamicImage::ImageRgba8(pixels);
    let pixels = match format {
        ImageFormat::Jpeg => ::image::DynamicImage::ImageRgb8(pixels.to_rgb8()),
        _ => pixels,
    };
    let mut bytes = std::io::Cursor::new(Vec::new());
    pixels.write_to(&mut bytes, format).expect("encode");
    bytes.into_inner()
}

// Contrat du registre d'images : ce qu'aucun pilote ne revendique ressort en raison de rapport
// nommée, jamais en panique ni en échec — une texture illisible n'interrompt pas une compilation.
#[test]
fn a_format_outside_the_registry_is_named_in_the_report() {
    assert!(registry::by_extension(Path::new("albedo.exr")).is_none());
    assert!(registry::by_extension(Path::new("albedo")).is_none());
    assert_eq!(
        registry::decode(b"\x76\x2f\x31\x01openexr", MAX_ALLOC).err(),
        Some("image-format-unknown")
    );
    // Des octets reconnus mais tronqués sont une autre raison : le pilote a bien été choisi.
    assert_eq!(
        registry::decode(b"\x89PNG\r\n\x1a\ntruncated", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
}

// Contrat du registre d'images : un pilote par format, désigné par son extension comme par son
// nombre magique, qui décode vers le type de sortie du contrat.
#[test]
fn png_and_jpeg_are_each_decoded_by_their_own_plugin() {
    for (format, name, mime, extensions) in [
        (ImageFormat::Png, "png", "image/png", ["png", "png"]),
        (ImageFormat::Jpeg, "jpeg", "image/jpeg", ["jpg", "jpeg"]),
    ] {
        let bytes = encoded(format);
        let decoder = registry::by_head(&bytes).expect("a plugin claims these bytes");
        assert_eq!(decoder.name(), name);
        assert_eq!(decoder.mime(), mime);
        for extension in extensions {
            let path = PathBuf::from(format!("albedo.{extension}"));
            assert_eq!(
                registry::by_extension(&path).expect("claimed").name(),
                name,
                "{extension}"
            );
        }
        let registry::DecodedImage::Rgba8(pixels) =
            registry::decode(&bytes, MAX_ALLOC).expect("decoded");
        assert_eq!((pixels.width(), pixels.height()), (2, 2));
    }
    // L'ordre du registre est celui dans lequel on cherche un fichier voisin décodable.
    assert_eq!(
        registry::extensions().collect::<Vec<_>>(),
        ["png", "jpg", "jpeg", "tga", "tpic", "tif", "tiff", "dds"]
    );
}

// Contrat commun : l'identité du registre entre dans celle du cache, et se publie telle quelle.
#[test]
fn the_registry_fingerprint_names_every_plugin_and_both_contracts() {
    let print = fingerprint();
    for expected in [
        scene::VERSION,
        registry::VERSION,
        "gltf=",
        "fbx=",
        "obj=",
        "unity=",
        "zip=",
        "png=",
        "jpeg=",
        "tga=",
        "tiff=",
        "dds=",
    ] {
        assert!(print.contains(expected), "{print}");
    }
    assert_eq!(descriptor()["scene"].as_array().map(Vec::len), Some(5));
    assert_eq!(descriptor()["image"].as_array().map(Vec::len), Some(5));
}
