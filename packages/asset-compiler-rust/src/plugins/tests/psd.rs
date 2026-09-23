//! Golden of the PSD driver: fixtures of `tests/fixtures/formats/psd/`, written here from the specification
//! Adobe publishes for third-party readers, must yield exactly the pixels written in the open
//! below. Raw surface and run-length compressed lines are two ways of writing the same
//! composite, in PSD as in PSB — the golden proves it by comparing them to the same reference.
use super::super::image as registry;
use super::{assert_claims, assert_refusals, decoded_rgba8, fixture};

mod declarations;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// Dimensions of every fixture: two lines of four pixels, the smallest image where a run of
/// three pixels and an isolated pixel fit in the same compressed line.
const SIZE: (u32, u32) = (4, 2);

/// Reference composite in RGB, top row first: three identical pixels then another, so a run and
/// a raw packet follow each other in the same line. Alpha is opaque: three-channel fixtures
/// carry no plane of it, and the driver does not invent it.
const RVB: [[u8; 4]; 8] = [
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [200, 100, 50, 255],
    [0, 255, 0, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
];

/// The same composite in grey levels: the unique colour channel carries the three components,
/// without any matrix or profile intervening.
const GRIS: [[u8; 4]; 8] = [
    [10, 10, 10, 255],
    [10, 10, 10, 255],
    [10, 10, 10, 255],
    [200, 200, 200, 255],
    [0, 0, 0, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
];

/// Alpha plane of the fixtures that carry one: a transparent pixel in the first line, a run at
/// a quarter opacity in the second.
const ALPHA: [u8; 8] = [255, 255, 255, 0, 64, 64, 64, 64];

/// The reference, its alpha plane laid on top.
fn with_alpha(base: [[u8; 4]; 8]) -> Vec<[u8; 4]> {
    base.iter()
        .zip(ALPHA)
        .map(|(pixel, alpha)| [pixel[0], pixel[1], pixel[2], alpha])
        .collect()
}

/// Pixels of a fixture, in read order of the decoded image.
fn pixels(name: &str) -> Vec<[u8; 4]> {
    decoded_rgba8("psd", name, MAX_ALLOC, SIZE)
        .pixels()
        .map(|pixel| pixel.0)
        .collect()
}

// Driver golden: both writings of the composite and both versions of the format yield, pixel by
// pixel, the same image. Flattened means: what the file already carries, and nothing else.
#[test]
fn both_writings_of_the_composite_yield_the_reference_pixels() {
    for name in ["rgb-brut.psd", "rgb-rle.psd", "grand-format.psb"] {
        assert_eq!(pixels(name), RVB.to_vec(), "{name}");
    }
    assert_eq!(
        pixels("gris-brut.psd"),
        GRIS.to_vec(),
        "one colour channel carries the three components"
    );
}

// Driver contract: what it claims, and what it refuses by naming it. A PSD outside the subset
// lets the engine fall back on its white; it interrupts no compilation.
#[test]
fn what_leaves_the_subset_comes_out_as_a_report_reason_never_as_a_panic() {
    assert_claims("psd", "image/vnd.adobe.photoshop", &["psd", "psb", "PSD"]);
    // The signature remains that of a Photoshop: each refusal is claimed by this driver.
    assert_refusals(
        "psd",
        MAX_ALLOC,
        &[
            ("seize-bits.psd", "psd-depth-unsupported"),
            ("cmjn.psd", "psd-color-mode-unsupported"),
            ("canaux-en-trop.psd", "psd-channels-unsupported"),
            ("zip.psd", "psd-compression-unsupported"),
            ("sans-composite.psd", "psd-composite-missing"),
            ("tronque.psd", "psd-data-truncated"),
        ],
    );
    // Without the signature and its version number, the driver claims nothing: better an
    // unknown format than bytes stolen from a neighbour.
    assert!(registry::by_head(b"8BPS\0\x09").is_none());
}

// Driver contract: a header whose a field leaves its domain is named, never guessed. Zero width
// is the case the rest of the driver cannot recover.
#[test]
fn a_header_outside_domain_is_refused_by_name() {
    let mut bytes = fixture("psd", "rgb-brut.psd");
    bytes[18..22].fill(0);
    assert_eq!(
        registry::decode(&bytes, MAX_ALLOC).err(),
        Some("psd-header-invalid"),
        "a zero width is not an image"
    );
}

// Driver contract: the allocation ceiling counts four bytes per pixel, those of the output
// contract. An image that does not fit is a named refusal, never an allocation attempted.
#[test]
fn the_allocation_ceiling_counts_four_bytes_per_pixel() {
    let bytes = fixture("psd", "rgb-brut.psd");
    assert_eq!(
        registry::decode(&bytes, 31).err(),
        Some("psd-image-too-large"),
        "eight RGBA8 pixels weigh thirty-two bytes"
    );
    assert!(registry::decode(&bytes, 32).is_ok(), "just enough room");
}
