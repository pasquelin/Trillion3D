//! Golden of the TGA driver: each profile of the format, decoded from a real file of
//! `tests/fixtures/formats/tga/`, must yield exactly the same RGBA8 pixels — written in the open here.
//! Origin, compression and depth are ways of writing the same image, never of changing it.
use super::super::image as registry;
use super::fixture;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Reference image, 4 × 2 pixels, top row first. It mixes opaque alpha, partial alpha and zero
/// alpha so the slightest clipping of the channel shows.
// The TGA fixtures are their own 4 × 2 image; the DDS surfaces are 4 × 4 and only open alike.
// jscpd:ignore-start
const REFERENCE: [[u8; 4]; 8] = [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 255],
    [255, 255, 0, 64],
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [17, 34, 51, 68],
    [200, 100, 50, 150],
];
// jscpd:ignore-end

/// The same image without an alpha channel: what profiles that carry none yield.
fn opaque() -> Vec<[u8; 4]> {
    REFERENCE
        .iter()
        .map(|[r, g, b, _]| [*r, *g, *b, 255])
        .collect()
}

/// Pixels of a fixture, in read order of the decoded image.
fn pixels(name: &str) -> Vec<[u8; 4]> {
    super::decoded_rgba8("tga", name, MAX_ALLOC, (4, 2))
        .pixels()
        .map(|pixel| pixel.0)
        .collect()
}

// TGA driver golden: the six profiles the driver announces it reads yield, pixel by pixel, the
// reference written in the open. Lossless means: not one byte of difference.
#[test]
fn each_tga_profile_yields_the_reference_pixels() {
    let alpha = REFERENCE.to_vec();
    let opaque = opaque();
    for (name, expected) in [
        ("vraies-couleurs-32-haut.tga", &alpha),
        ("vraies-couleurs-32-rle-haut.tga", &alpha),
        ("vraies-couleurs-32-rle-bas.tga", &alpha),
        ("vraies-couleurs-24-bas.tga", &opaque),
        ("palette-8-haut.tga", &opaque),
    ] {
        assert_eq!(&pixels(name), expected, "{name}");
    }
    // Grey levels carry the other reference: one value per pixel, extended to the three
    // channels, opaque. The driver does not colour it and does not rescale it.
    let gris: Vec<[u8; 4]> = [0u8, 64, 128, 255, 16, 32, 48, 64]
        .iter()
        .map(|v| [*v, *v, *v, 255])
        .collect();
    assert_eq!(pixels("niveaux-de-gris-8-bas.tga"), gris);
}

// Driver contract: what it recognises, what it refuses, and under which name it reports it. An
// unreadable TGA lets the engine fall back on its white; it interrupts no compilation.
#[test]
fn an_unreadable_tga_comes_out_as_a_report_reason_never_as_a_panic() {
    super::assert_claims("tga", "image/x-tga", &["tga", "tpic", "TGA"]);
    // Truncated: the header is recognised, so the driver is chosen, and it is decoding that fails.
    let tronque = fixture("tga", "tronque.tga");
    assert_eq!(
        registry::by_head(&tronque).map(|d| d.name()),
        Some("tga"),
        "the header of a truncated file remains a TGA header"
    );
    assert_eq!(
        registry::decode(&tronque, MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
    // TGA has no magic number: without a coherent header, the driver claims nothing. A zero
    // width, a palette announced without a palette type, an unknown image type and bytes too
    // short to carry a header are so many refusals.
    for (case, head) in [
        (
            "zero width",
            [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 24, 0],
        ),
        (
            "palette without type",
            [0, 0, 2, 0, 0, 4, 0, 24, 0, 0, 0, 0, 4, 0, 2, 0, 24, 0],
        ),
        (
            "unknown type",
            [0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2, 0, 24, 0],
        ),
        (
            "depth outside profile",
            [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2, 0, 12, 0],
        ),
    ] {
        assert_eq!(
            registry::decode(&head, MAX_ALLOC).err(),
            Some("image-format-unknown"),
            "{case}"
        );
    }
    assert!(
        registry::by_head(&tronque[..8]).is_none(),
        "incomplete header"
    );
}

/// A one-pixel true-colour 24-bit TGA, top origin: eighteen header bytes then the pixel, written
/// BGR as the format asks. Three bytes written, four once extended to RGBA8: that is the gap the
/// ceiling must see.
const ONE_PIXEL: [u8; 21] = [
    0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0x20, 10, 20, 30,
];

// Finding 7: the allocation ceiling equals the final image size in RGBA8 — width by height by
// four bytes — checked before any decoding. A thirty-two-bit pixel used to pass under a
// three-byte ceiling, then four were allocated to carry it.
#[test]
fn the_ceiling_covers_the_final_rgba8_size_before_any_decoding() {
    assert_eq!(
        registry::by_head(&ONE_PIXEL).map(|d| d.name()),
        Some("tga"),
        "a one-pixel TGA remains claimed by its header"
    );
    assert_eq!(
        registry::decode(&ONE_PIXEL, 3).err(),
        Some("image-too-large"),
        "an RGBA8 pixel weighs four bytes, above a ceiling of three"
    );
    let decoded = super::rgba8(registry::decode(&ONE_PIXEL, MAX_ALLOC).expect("under the ceiling"));
    assert_eq!(decoded.into_raw(), vec![30, 20, 10, 255]);
}
