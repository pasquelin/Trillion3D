//! Golden of the OpenEXR driver: files of `fixtures/exr/`, written here from the public
//! specification, must yield exactly the float values written in the open below — half and
//! single precision together, since the half-float extends to `f32` without rounding. And what
//! leaves the subset must come out by its name, never as a panic or as an approximated image.
use super::super::image as registry;
use super::{fixture, rgba_f32};
use std::path::PathBuf;

/// Four pixels are enough to hold read order, the four channels and the missing-alpha case;
/// values are exact in both precisions, so a mismatch comes from the driver.
const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// What the files **carry**, 2 × 2, top row first, RGBA: samples associated with their alpha, as
/// the OpenEXR specification defines them.
const STOCKE: [[f32; 4]; 4] = [
    [1.0, 0.5, 0.25, 1.0],
    [0.0, 2.0, 4.0, 0.5],
    [8.0, 0.125, 16.0, 0.0],
    [0.75, 1.5, 3.0, 0.25],
];

/// What the contract **yields**: the same samples at straight alpha. Each component is divided
/// by the pixel's alpha; the zero-alpha pixel keeps its own, otherwise dividing them. Quotients
/// are exact in single precision, so a mismatch can only come from the driver.
const DROIT: [[f32; 4]; 4] = [
    [1.0, 0.5, 0.25, 1.0],
    [0.0, 4.0, 8.0, 0.5],
    [8.0, 0.125, 16.0, 0.0],
    [3.0, 6.0, 12.0, 0.25],
];

/// Pixels of a fixture, in read order of the decoded image.
fn pixels(name: &str) -> Vec<[f32; 4]> {
    let bytes = fixture("exr", name);
    let decoder = registry::by_head(&bytes).expect("a driver claims these bytes");
    assert_eq!(decoder.name(), "exr", "{name}");
    let (width, height, data) =
        rgba_f32(registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|e| panic!("{name}: {e}")));
    assert_eq!((width, height), (2, 2), "{name}");
    data.as_chunks::<4>().0.to_vec()
}

// Driver golden: both precisions of the subset yield the same image, value by value, and a file
// without an alpha channel yields the opaque alpha the specification prescribes — not a zero.
#[test]
fn both_precisions_yield_the_reference_values() {
    assert_eq!(pixels("demi.exr"), DROIT.to_vec());
    // Without channel `A`, alpha is opaque: dividing by one changes nothing, RGB come out as-is.
    let opaque: Vec<[f32; 4]> = STOCKE
        .iter()
        .map(|[r, g, b, _]| [*r, *g, *b, 1.0])
        .collect();
    assert_eq!(pixels("flottant.exr"), opaque);
}

// Reproduction of finding 53: an OpenEXR's alpha is associated — the Academy Software
// Foundation specification says RGB are premultiplied —, while the output contract asks for
// straight alpha. Yielding the samples as-is delivered an image twice-premultiplied downstream,
// where the preview premultiplies in turn. Here each component is divided by the pixel's alpha,
// and the zero-alpha pixel divides nothing: there is no straight colour to recover under a zero
// alpha.
#[test]
fn an_exr_associated_alpha_comes_out_straight_without_dividing_by_zero() {
    let rendu = pixels("demi.exr");
    for (pixel, (stocke, droit)) in rendu.iter().zip(STOCKE.iter().zip(DROIT)) {
        assert_eq!(*pixel, droit, "stored {stocke:?}");
    }
    // The two pixels whose alpha is neither 0 nor 1 are those that move: the golden says so
    // out loud rather than letting one believe the division has no effect.
    assert_ne!(rendu[1], STOCKE[1]);
    assert_ne!(rendu[3], STOCKE[3]);
    // Zero alpha keeps its components: no division, no infinity, no NaN.
    assert_eq!(rendu[2], STOCKE[2]);
    assert!(rendu.iter().flatten().all(|value| value.is_finite()));
}

// Driver contract: what it claims, and what it refuses by naming it. An EXR outside the subset
// lets the engine fall back on its white; it interrupts no compilation.
#[test]
fn what_leaves_the_subset_comes_out_as_a_report_reason_never_as_a_panic() {
    let claimed = registry::by_extension(&PathBuf::from("environnement.EXR")).expect("claimed");
    assert_eq!(claimed.name(), "exr");
    assert_eq!(claimed.mime(), "image/x-exr");
    for (name, reason) in [
        ("profond.exr", "exr-deep-unsupported"),
        ("multi-parties.exr", "exr-multipart-unsupported"),
        ("canaux-xyz.exr", "exr-channels-unsupported"),
        ("tronque.exr", "exr-header-invalid"),
    ] {
        let bytes = fixture("exr", name);
        assert_eq!(
            registry::by_head(&bytes).map(|d| d.name()),
            Some("exr"),
            "{name}: the magic number remains that of an EXR"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(reason),
            "{name}"
        );
    }
}

// Driver contract: the allocation ceiling counts sixteen bytes per pixel, those of the float
// variant. An image that does not fit is a named refusal, never an allocation attempted.
#[test]
fn the_allocation_ceiling_counts_sixteen_bytes_per_pixel() {
    let bytes = fixture("exr", "demi.exr");
    assert_eq!(
        registry::decode(&bytes, 63).err(),
        Some("exr-image-too-large"),
        "four float pixels weigh sixty-four bytes"
    );
    assert!(registry::decode(&bytes, 64).is_ok(), "just enough room");
}
