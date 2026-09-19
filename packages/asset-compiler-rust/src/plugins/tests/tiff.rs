//! Golden of the TIFF driver: each declared profile, decoded from a real file of
//! `fixtures/tiff/`, yields exactly the same RGBA8 pixels — written in the open here. Byte
//! order, compression and component count are ways of writing the same image, never of changing
//! it. And what the driver does not declare, it refuses by naming it: that is the second half
//! of the contract, the one that stops a 16-bit from coming back clipped to eight.
use super::super::image as registry;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Reference image, 4 × 2 pixels, top row first.
const COULEURS: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 0, 0],
    [255, 255, 255],
    [17, 34, 51],
    [200, 100, 50],
];
/// Its alpha channel: opaque, partial and zero mixed, so the slightest clipping shows.
const ALPHA: [u8; 8] = [255, 128, 255, 64, 0, 255, 68, 150];
/// The other reference, that of single-component profiles.
const GRIS: [u8; 8] = [0, 64, 128, 255, 16, 32, 48, 64];

/// What the registry yields for this fixture, in read order of the decoded image.
fn rendus(name: &str) -> Vec<[u8; 4]> {
    super::decoded_rgba8("tiff", name, MAX_ALLOC, (4, 2))
        .pixels()
        .map(|pixel| pixel.0)
        .collect()
}

// TIFF driver golden: the seven writings of the three declared profiles yield, pixel by pixel,
// the reference written in the open. Lossless means: not one byte of difference.
#[test]
fn each_declared_tiff_profile_yields_the_reference_pixels() {
    // RGB8: the two byte orders and the four lossless compressions are only five ways of
    // writing the same image. Alpha missing from the format is filled to 255, not invented.
    let rgb: Vec<[u8; 4]> = COULEURS.iter().map(|[r, v, b]| [*r, *v, *b, 255]).collect();
    for name in [
        "rgb8-brut-ii.tiff",
        "rgb8-brut-mm.tiff",
        "rgb8-lzw.tiff",
        "rgb8-deflate.tiff",
        "rgb8-packbits.tiff",
    ] {
        assert_eq!(rendus(name), rgb, "{name}");
    }
    // RGBA8 with unassociated alpha: the four bytes pass as-is, zero alpha included.
    let rgba: Vec<[u8; 4]> = COULEURS
        .iter()
        .zip(ALPHA)
        .map(|([r, v, b], a)| [*r, *v, *b, a])
        .collect();
    assert_eq!(rendus("rgba8-brut.tiff"), rgba);
    // 8-bit grey, black at zero: the value goes to the three channels, without tint or rescaling.
    let gris: Vec<[u8; 4]> = GRIS.iter().map(|v| [*v, *v, *v, 255]).collect();
    assert_eq!(rendus("gris8-brut.tiff"), gris);
}

// Driver contract: what it recognises, what it refuses, and under which name it reports it.
// TIFF is a field container, so half the work is to say no; a refused TIFF lets the engine
// fall back on its white, it interrupts no compilation and never panics.
#[test]
fn a_tiff_outside_profile_comes_out_as_a_report_reason_never_as_a_panic() {
    super::assert_claims("tiff", "image/tiff", &["tif", "tiff", "TIFF"]);
    super::assert_refusals(
        "tiff",
        MAX_ALLOC,
        &[
            // 16-bit has its own reason: the contract output cannot carry it yet, and lowering
            // it to eight in silence would add a loss the source did not have.
            ("gris16.tiff", "image-depth-unsupported"),
            // Valid profiles but outside those the driver declares it reads.
            ("palette8.tiff", "image-profile-unsupported"),
            ("rgb8-jpeg.tiff", "image-profile-unsupported"),
            ("ccitt-g4.tiff", "image-profile-unsupported"),
            ("deux-pages.tiff", "image-profile-unsupported"),
            ("rgb8-plans-separes.tiff", "image-profile-unsupported"),
            // Associated alpha: premultiplied, so not the contract's straight alpha. Yielding
            // it as-is would change the colours, and un-multiplying would be another operation
            // this driver does not announce.
            ("rgba8-alpha-associe.tiff", "image-profile-unsupported"),
            // Truncated: the header is a TIFF header, so the driver is chosen and it is the
            // read that fails.
            ("tronque.tif", "image-decode-failed"),
        ],
    );
    // BigTIFF shares the extension and almost the header; its addresses fit on eight bytes, it
    // is another format. The driver claims it to name it, rather than letting it come out as an
    // unknown format.
    for entete in [b"II\x2b\x00\x08\x00\x00\x00", b"MM\x00\x2b\x00\x08\x00\x00"] {
        assert_eq!(
            registry::by_head(entete).map(|pilote| pilote.name()),
            Some("tiff")
        );
        assert_eq!(
            registry::decode(entete, MAX_ALLOC).err(),
            Some("image-profile-unsupported")
        );
    }
    // Without a complete magic number, the driver claims nothing: these bytes come out as an
    // unknown format, not as an unreadable TIFF.
    for head in [b"II\x00\x00".as_slice(), b"MM\x2a\x00", b"II\x2a"] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
