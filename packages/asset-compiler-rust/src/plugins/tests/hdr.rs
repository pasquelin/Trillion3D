//! Golden of the Radiance HDR driver: files of `tests/fixtures/formats/hdr/`, written here from the public
//! specification, must yield exactly the float values written in the open below. Raw line, old
//! compression and new compression are three ways of writing the same line — the golden proves
//! it by comparing their pixels to the same reference.
use super::super::image as registry;
use super::{fixture, rgba_f32};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// The four pixels the fixtures are made of, in linear RGBA. Each comes from an RGBE quadruplet
/// whose exponent is readable by eye: `(128, 64, 32, 128)` is `2^-8` times its mantissas,
/// `(0, 128, 0, 140)` is `2^4` times theirs, and alpha is opaque everywhere.
const PALE: [f32; 4] = [0.5, 0.25, 0.125, 1.0];
const BLANC: [f32; 4] = [1.9921875, 1.9921875, 1.9921875, 1.0];
const VERT_VIF: [f32; 4] = [0.0, 2048.0, 0.0, 1.0];
const GRIS: [f32; 4] = [128.0, 128.0, 128.0, 1.0];

/// Reference image of the 4 × 2 fixtures, top row first: three identical pixels then another,
/// so a run and a raw packet follow each other in the same line.
const REFERENCE_4X2: [[f32; 4]; 8] = [PALE, PALE, PALE, BLANC, VERT_VIF, GRIS, GRIS, GRIS];

/// Reference image of the 8 × 1 fixture: the new compression is only written beyond eight
/// pixels wide, and this one carries a run of four then isolated values.
const REFERENCE_8X1: [[f32; 4]; 8] = [PALE, PALE, PALE, PALE, BLANC, VERT_VIF, GRIS, GRIS];

/// Pixels of a fixture, in read order of the decoded image.
fn pixels(name: &str, size: (u32, u32)) -> Vec<[f32; 4]> {
    let bytes = fixture("hdr", name);
    let decoder = registry::by_head(&bytes).expect("a driver claims these bytes");
    assert_eq!(decoder.name(), "hdr", "{name}");
    let (width, height, data) =
        rgba_f32(registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|e| panic!("{name}: {e}")));
    assert_eq!((width, height), size, "{name}");
    data.as_chunks::<4>().0.to_vec()
}

// Driver golden: the three writings of a line and the two format signatures yield, value by
// value, the same image. Lossless means: not one mantissa bit of difference.
#[test]
fn the_three_writings_of_a_line_yield_the_reference_values() {
    for name in ["plat.hdr", "rle-ancienne.hdr", "signature-rgbe.hdr"] {
        assert_eq!(pixels(name, (4, 2)), REFERENCE_4X2.to_vec(), "{name}");
    }
    assert_eq!(
        pixels("rle-nouvelle.hdr", (8, 1)),
        REFERENCE_8X1.to_vec(),
        "component compression yields the same image as the others"
    );
}

// Driver contract: what it claims, and what it refuses by naming it. An HDR outside the subset
// lets the engine fall back on its white; it interrupts no compilation.
#[test]
fn what_leaves_the_subset_comes_out_as_a_report_reason_never_as_a_panic() {
    for extension in ["hdr", "rgbe", "pic", "HDR"] {
        let path = PathBuf::from(format!("environnement.{extension}"));
        let claimed = registry::by_extension(&path).expect("claimed");
        assert_eq!(claimed.name(), "hdr", "{extension}");
        assert_eq!(claimed.mime(), "image/vnd.radiance");
    }
    for (name, reason) in [
        ("xyze.hdr", "hdr-format-unsupported"),
        ("bas-en-haut.hdr", "hdr-orientation-unsupported"),
        ("tronque.hdr", "hdr-data-truncated"),
    ] {
        let bytes = fixture("hdr", name);
        assert_eq!(
            registry::by_head(&bytes).map(|d| d.name()),
            Some("hdr"),
            "{name}: the signature remains that of a Radiance"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(reason),
            "{name}"
        );
    }
    // Without a signature, the driver claims nothing: better an unknown format than bytes
    // stolen from a neighbour.
    assert!(registry::by_head(b"#?AUTRECHOSE\n").is_none());
}

// Driver contract: the allocation ceiling counts sixteen bytes per pixel, those of the float
// variant. An image that does not fit is a named refusal, never an allocation attempted.
#[test]
fn the_allocation_ceiling_counts_sixteen_bytes_per_pixel() {
    let bytes = fixture("hdr", "plat.hdr");
    assert_eq!(
        registry::decode(&bytes, 127).err(),
        Some("hdr-image-too-large"),
        "eight float pixels weigh one hundred and twenty-eight bytes"
    );
    assert!(registry::decode(&bytes, 128).is_ok(), "just enough room");
}
