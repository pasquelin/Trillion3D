//! Golden of the GIF driver: an indexed image yields its colours as-is, whether its table is
//! global or local, the declared transparent index becomes a zero alpha, and a file that
//! carries more than one image is refused by naming it. It is that refusal that counts most
//! here: choosing by default which of an animation's images is *the* texture would be
//! arbitrary.
use super::super::image as registry;
use super::{
    assert_claims, assert_refusals, decoded_rgba8, fixture, rgba8, REFERENCE_RGB as REFERENCE,
};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Alpha of the file with a transparent index: the last pixel carries the index declared
/// transparent by the graphic control extension, and it alone.
const ALPHA_TRANSPARENT: [u8; 8] = [255, 255, 255, 255, 255, 255, 255, 0];
const OPAQUE: [u8; 8] = [255; 8];

/// Where the first image of `anime.gif` ends: thirteen bytes of header and screen descriptor,
/// twenty-four of global colour table, then the nineteen of the first image block.
const PREMIERE_IMAGE_FIN: usize = 13 + 24 + 19;

fn expected(alpha: &[u8; 8]) -> Vec<u8> {
    REFERENCE
        .iter()
        .zip(alpha)
        .flat_map(|(colour, alpha)| [colour[0], colour[1], colour[2], *alpha])
        .collect()
}

/// Image the registry yields for this fixture, dimensions checked along the way.
fn rendu(name: &str) -> image::RgbaImage {
    decoded_rgba8("gif", name, MAX_ALLOC, (4, 2))
}

// GIF driver golden: the global colour table and the local table carry the same image and yield
// the same bytes — where the table comes from does not change a pixel. The transparent index,
// for its part, only changes alpha: the colour the table gives it stays there, it is neither
// erased nor filled with white, and nothing is premultiplied.
#[test]
fn the_two_colour_tables_yield_the_same_pixels() {
    for name in ["palette-globale.gif", "palette-locale.gif"] {
        assert_eq!(
            rendu(name).as_raw(),
            &expected(&OPAQUE),
            "{name}: pixels diverge from the reference"
        );
    }
    assert_eq!(
        rendu("transparence.gif").as_raw(),
        &expected(&ALPHA_TRANSPARENT),
        "the transparent index touches only alpha, never the table colour"
    );
}

// Driver contract: what it recognises, what it refuses, and under which name it reports it. A
// refused GIF lets the engine fall back on its white; it interrupts no compilation and never
// panics. An animation is dropped before any decoding, by the `webp` driver's reason: an
// animation refusal is an animation refusal, whatever format carries it.
#[test]
fn a_gif_outside_policy_comes_out_as_a_report_reason_never_as_a_panic() {
    assert_claims("gif", "image/gif", &["gif", "GIF", "Gif"]);
    assert_refusals(
        "gif",
        MAX_ALLOC,
        &[
            ("anime.gif", "image-animation-unsupported"),
            // Truncated: the signature remains that of a GIF, so the driver is chosen, and the
            // walk of the blocks stops for lack of bytes — without concluding to an animation.
            ("tronque.gif", "image-decode-failed"),
        ],
    );
    // Both versions of the format carry the same structure: 87a has no extensions, and the walk
    // of the blocks must cross it as well as 89a.
    let mut ancienne = fixture("gif", "palette-globale.gif");
    ancienne[..6].copy_from_slice(b"GIF87a");
    assert_eq!(rendu_octets(&ancienne), expected(&OPAQUE));
    // `anime.gif` cut at the end of its first image: no next block, and no terminator either.
    // The walk therefore does not conclude to animation, and the decoder reads the whole image
    // that remains — an image without a terminator is an image, not an animation.
    let anime = fixture("gif", "anime.gif");
    assert_eq!(
        rendu_octets(&anime[..PREMIERE_IMAGE_FIN]),
        expected(&OPAQUE)
    );
    // Four bytes further, the second image separator is there and its descriptor is cut: that
    // is enough to prove the second image, and it is as animation that the file is refused.
    assert_eq!(
        registry::decode(&anime[..PREMIERE_IMAGE_FIN + 4], MAX_ALLOC).err(),
        Some("image-animation-unsupported")
    );
    // The signature is the only mark of the format: without it, these bytes come out as an
    // unknown format rather than as an unreadable GIF.
    for head in [b"GIF89".as_slice(), b"GIF90a\x04\x00\x02\x00"] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}

/// Bytes the registry yields for bytes held in memory, without going through a file.
fn rendu_octets(bytes: &[u8]) -> Vec<u8> {
    rgba8(registry::decode(bytes, MAX_ALLOC).expect("decoded"))
        .as_raw()
        .clone()
}
