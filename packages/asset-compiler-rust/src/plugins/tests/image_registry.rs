use super::super::{descriptor, fingerprint, image as registry, scene};
use ::image::{ImageFormat, Rgba, RgbaImage};
use std::path::{Path, PathBuf};

const MAX_ALLOC: u64 = 64 * 1024 * 1024;

/// A four-pixel image, encoded in the requested format.
fn encoded(format: ImageFormat) -> Vec<u8> {
    let mut pixels = RgbaImage::new(2, 2);
    pixels.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
    pixels.put_pixel(1, 1, Rgba([0, 0, 255, 255]));
    // JPEG has no alpha channel: it is the format that imposes the conversion, not the contract.
    let pixels = ::image::DynamicImage::ImageRgba8(pixels);
    let pixels = match format {
        ImageFormat::Jpeg => ::image::DynamicImage::ImageRgb8(pixels.to_rgb8()),
        _ => pixels,
    };
    let mut bytes = std::io::Cursor::new(Vec::new());
    pixels.write_to(&mut bytes, format).expect("encode");
    bytes.into_inner()
}

// Image-registry contract: what no driver claims comes out as a named report reason, never as a
// panic or a failure — an unreadable texture does not interrupt a compilation.
#[test]
fn a_format_outside_the_registry_is_named_in_the_report() {
    assert!(registry::by_extension(Path::new("albedo.xcf")).is_none());
    assert!(registry::by_extension(Path::new("albedo")).is_none());
    assert_eq!(
        registry::decode(b"gimp xcf v011", MAX_ALLOC).err(),
        Some("image-format-unknown")
    );
    // Recognised but truncated bytes are another reason: the driver was chosen correctly.
    assert_eq!(
        registry::decode(b"\x89PNG\r\n\x1a\ntruncated", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
}

// Image-registry contract: one driver per format, named by its extension as by its magic number,
// which decodes to the contract's output type.
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
        let pixels = super::rgba8(registry::decode(&bytes, MAX_ALLOC).expect("decoded"));
        assert_eq!((pixels.width(), pixels.height()), (2, 2));
    }
    // Registry order is the order in which a neighbouring decodable file is looked up.
    assert_eq!(
        registry::extensions().collect::<Vec<_>>(),
        [
            "png", "jpg", "jpeg", "tga", "tpic", "tif", "tiff", "dds", "webp", "exr", "hdr",
            "rgbe", "pic", "ktx2", "psd", "psb", "bmp", "dib", "rle", "gif"
        ]
    );
}

// Shared contract: the registry identity enters that of the cache, and is published as-is.
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
        "blend=",
        "zip=",
        "unitypackage=",
        "alembic=",
        "usd=",
        "usdz=",
        "ma=",
        "png=",
        "jpeg=",
        "tga=",
        "tiff=",
        "dds=",
        "webp=",
        "exr=",
        "hdr=",
        "ktx2=",
        "psd=",
        "bmp=",
        "gif=",
    ] {
        assert!(print.contains(expected), "{print}");
    }
    assert_eq!(descriptor()["scene"].as_array().map(Vec::len), Some(11));
    assert_eq!(descriptor()["image"].as_array().map(Vec::len), Some(12));
}
