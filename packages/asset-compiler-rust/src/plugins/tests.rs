//! Tests of the two contracts, and of them alone: what the router chooses, what it refuses, and
//! what the image registry can read. Each format's behaviour is proven in its fixture.
use super::*;
use std::{fs, path::PathBuf};

mod bmp;
mod dds;
mod exr;
mod gif;
mod hdr;
mod icc;
mod image_registry;
mod ktx2;
mod png;
mod psd;
mod router;
mod tga;
mod tiff;
mod webp;

/// Pixels of a driver that yields RGBA8. The contract has two outputs: a test that expects the
/// first says so, rather than letting an irrefutable `let` assume it.
fn rgba8(decoded: image::ImageDecoded) -> ::image::RgbaImage {
    match decoded.image {
        image::DecodedImage::Rgba8(pixels) => pixels,
        image::DecodedImage::RgbaF32 { .. } => panic!("this driver must yield RGBA8"),
    }
}

/// What a driver declared around the pixels: its transfer function and the named reasons of what
/// the file carried without the output being able to carry it, in the order it recorded them.
fn declared(pilote: &str, name: &str, max_alloc: u64) -> (image::Transfer, Vec<&'static str>) {
    let bytes = fixture(pilote, name);
    let decoded =
        image::decode(&bytes, max_alloc).unwrap_or_else(|error| panic!("{name}: {error}"));
    (decoded.transfer, decoded.notes)
}

/// RGBA8 image the registry yields for a fixture of `tests/fixtures/formats/<pilote>/`: this driver claims it
/// by its bytes, and it has the expected dimensions.
fn decoded_rgba8(pilote: &str, name: &str, max_alloc: u64, size: (u32, u32)) -> ::image::RgbaImage {
    let bytes = fixture(pilote, name);
    let claimed = image::by_head(&bytes).expect("a driver claims these bytes");
    assert_eq!(claimed.name(), pilote, "{name}");
    let decoded =
        rgba8(image::decode(&bytes, max_alloc).unwrap_or_else(|error| panic!("{name}: {error}")));
    assert_eq!(decoded.dimensions(), size, "{name}");
    decoded
}

/// What a driver claims by extension: each writing names it, under its MIME type.
fn assert_claims(pilote: &str, mime: &str, extensions: &[&str]) {
    for extension in extensions {
        let path = PathBuf::from(format!("albedo.{extension}"));
        let claimed = image::by_extension(&path).expect("claimed");
        assert_eq!(claimed.name(), pilote, "{extension}");
        assert_eq!(claimed.mime(), mime, "{extension}");
    }
}

/// Named refusals of a driver: each fixture stays claimed by its bytes, then comes out as a
/// report reason, never as a panic.
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

/// Values of a driver that yields float, with the dimensions it announces.
fn rgba_f32(decoded: image::ImageDecoded) -> (u32, u32, Vec<f32>) {
    match decoded.image {
        image::DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => (width, height, data),
        image::DecodedImage::Rgba8(_) => panic!("this driver must yield float"),
    }
}

/// Bytes of a real corpus file, stored in `tests/fixtures/formats/<folder>/`.
fn fixture(folder: &str, name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats")
        .join(folder)
        .join(name);
    fs::read(path).unwrap_or_else(|error| panic!("{folder}/{name}: {error}"))
}

/// A disposable directory, named by the case that uses it.
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

/// Reference image of the BMP and GIF fixtures, 4 × 2 pixels, top row first: four frank colours
/// then three mixes whose each component is exactly carried by five bits, and each green also by
/// six. That is what lets both 16-bit BMP writings yield those bytes and not their neighbours; GIF,
/// being indexed, yields them out of its table without rounding.
const REFERENCE_RGB: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [0, 0, 0],
    [247, 206, 8],
    [16, 49, 239],
    [132, 239, 66],
];
