//! Golden of the BMP driver: eight writings of the format yield the same four-by-two image, and
//! what the decoder would clip is refused before being read. It is the second half that counts:
//! a mask of more than eight bits per channel does not enter, because entering would cost it
//! its low bits — a loss the source did not have.
use super::super::image as registry;
use super::{assert_claims, assert_refusals, decoded_rgba8, fixture, REFERENCE_RGB as REFERENCE};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// One bit carries only two colours: this file has its own reference, a checkerboard.
const DAMIER: [[u8; 3]; 8] = [
    [255, 255, 255],
    [0, 0, 0],
    [255, 255, 255],
    [0, 0, 0],
    [0, 0, 0],
    [255, 255, 255],
    [0, 0, 0],
    [255, 255, 255],
];
/// Alpha of the only file that carries one: the V3 header masks declare it, and the driver
/// yields it straight — neither premultiplied, nor filled in by default.
const ALPHA_32: [u8; 8] = [255, 255, 255, 255, 255, 255, 128, 0];
const OPAQUE: [u8; 8] = [255; 8];

/// RGBA8 bytes a fixture must yield: the reference, and the alpha that is its own.
fn expected(colours: &[[u8; 3]; 8], alpha: &[u8; 8]) -> Vec<u8> {
    colours
        .iter()
        .zip(alpha)
        .flat_map(|(colour, alpha)| [colour[0], colour[1], colour[2], *alpha])
        .collect()
}

/// Image the registry yields for this fixture, dimensions checked along the way.
fn rendu(name: &str) -> image::RgbaImage {
    decoded_rgba8("bmp", name, MAX_ALLOC, (4, 2))
}

// BMP driver golden: eight writings of the format — two true-colour depths, three palettes, one
// run-length compression and two bit layouts on sixteen — carry the same image, and yield the
// same bytes. Line order is part of it: 24-bit is stored bottom-up and 32-bit top-down, and it
// is indeed the same image that comes out.
#[test]
fn all_writings_of_the_format_yield_the_same_pixels() {
    for name in [
        "vraies-couleurs-24-bas.bmp",
        "palette-8.bmp",
        "palette-8-rle.bmp",
        "palette-4.bmp",
        "r5g5b5.bmp",
        "r5g6b5.bmp",
    ] {
        assert_eq!(
            rendu(name).as_raw(),
            &expected(&REFERENCE, &OPAQUE),
            "{name}: pixels diverge from the reference"
        );
    }
    // The only fixture to carry an alpha: negative height, so stored top-down, and V3 header
    // masks — including the alpha mask, which shorter headers do not have.
    assert_eq!(
        rendu("vraies-couleurs-32-haut.bmp").as_raw(),
        &expected(&REFERENCE, &ALPHA_32),
        "32-bit alpha must be yielded straight, without filling or premultiplication"
    );
    assert_eq!(
        rendu("palette-1.bmp").as_raw(),
        &expected(&DAMIER, &OPAQUE),
        "a one-bit palette carries two colours, and both must be the right ones"
    );
}

// Driver contract: what it recognises, what it refuses, and under which name it reports it. A
// refused BMP lets the engine fall back on its white; it interrupts no compilation and never
// panics. The fidelity rule here drops everything the decoder would have clipped: a mask wider
// than eight bits would lose its low bits, and an embedded JPEG or PNG payload is not BMP but
// another format, which has its own driver.
#[test]
fn a_bmp_outside_policy_comes_out_as_a_report_reason_never_as_a_panic() {
    assert_claims("bmp", "image/bmp", &["bmp", "BMP", "dib", "rle"]);
    assert_refusals(
        "bmp",
        MAX_ALLOC,
        &[
            // 10-10-10 masks: the decoder would keep only the eight high bits of each channel.
            // Refused before any decoding, so without ever producing the impoverished pixels.
            ("masques-10-bits.bmp", "bmp-bitfields-lossy"),
            ("jpeg-embarque.bmp", "bmp-embedded-codec-unsupported"),
            // Truncated: the header remains a BMP header, so the driver is chosen, and it is
            // the pixel read that stops for lack of bytes.
            ("tronque.bmp", "image-decode-failed"),
        ],
    );
    // Two headers rewritten on a readable fixture, for the refusals no file carries: a depth
    // outside lossless profiles, and a compression outside the format read.
    let profondeur_at = 28;
    let compression_at = 30;
    for (at, valeur, raison) in [
        (profondeur_at, 64u32, "bmp-depth-unsupported"),
        // `BI_ALPHABITFIELDS`, which this driver does not read.
        (compression_at, 6, "bmp-compression-unsupported"),
    ] {
        let mut altere = fixture("bmp", "vraies-couleurs-24-bas.bmp");
        altere[at..at + 4].copy_from_slice(&valeur.to_le_bytes());
        assert_eq!(registry::decode(&altere, MAX_ALLOC).err(), Some(raison));
    }
    // “BM” is the only signature this driver claims: without it, these bytes come out as an
    // unknown format rather than as an unreadable BMP.
    for head in [
        b"BA\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".as_slice(),
        b"BM",
    ] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
