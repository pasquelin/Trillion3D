//! Golden of the WebP driver: the only stream the policy admits — `VP8L`, lossless — yields the
//! file's pixels, simple container as extended container, and everything else is refused by
//! naming it. It is the second half of the contract that counts here: a lossy stream is never
//! decoded, because accepting the source's loss would be accepting loss altogether.
use super::super::image as registry;
use super::{assert_claims, assert_refusals, decoded_rgba8, fixture};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// Fixtures are 256 × 256 RGBA8, that is 262 144 bytes: this ceiling does not let them through.
const MAX_ALLOC_TROP_PETIT: u64 = 64 * 1024;

/// Five texels of `sans-perte.webp` — four corners then the centre — verified by an independent
/// decoder (Pillow 12.2.0) before being written here. Alphas 0 and 255 sit side by side: an
/// alpha channel filled in by default or premultiplied would show at a glance.
const TEXELS: [(u32, u32, [u8; 4]); 5] = [
    (0, 0, [0, 0, 30, 0]),
    (255, 0, [255, 0, 220, 255]),
    (0, 255, [0, 255, 220, 255]),
    (255, 255, [255, 255, 30, 0]),
    (128, 128, [128, 128, 30, 0]),
];

/// Image the registry yields for this fixture.
fn rendu(name: &str) -> image::RgbaImage {
    decoded_rgba8("webp", name, MAX_ALLOC, (256, 256))
}

// WebP driver golden: a lossless stream yields its pixels as-is, and the extended container —
// its metadata chunks crossed — yields exactly the same bytes. Lossless means: not one byte of
// difference, from one writing of the format to the other.
#[test]
fn the_two_writings_of_lossless_yield_the_same_bytes() {
    let simple = rendu("sans-perte.webp");
    for (x, y, attendu) in TEXELS {
        assert_eq!(simple.get_pixel(x, y).0, attendu, "texel ({x}, {y})");
    }
    assert_eq!(
        rendu("etendu-sans-perte.webp").as_raw(),
        simple.as_raw(),
        "the extended container carries the same VP8L: its ICCP and header touch no pixel"
    );
}

// Driver contract: what it recognises, what it refuses, and under which name it reports it. A
// refused WebP lets the engine fall back on its white; it interrupts no compilation and never
// panics. The import policy admits WebP only lossless: the `VP8 ` stream is therefore dropped
// before any decoding, and an animation too — flattening it onto an image chosen by default
// would be arbitrary.
#[test]
fn a_webp_outside_policy_comes_out_as_a_report_reason_never_as_a_panic() {
    assert_claims("webp", "image/webp", &["webp", "WebP", "WEBP"]);
    assert_refusals(
        "webp",
        MAX_ALLOC,
        &[
            // Extended container, `ALPH` then the lossy stream: the driver walks the chunks, it
            // does not merely look at the first.
            ("avec-perte.webp", "image-lossy-unsupported"),
            ("anime.webp", "image-animation-unsupported"),
            // Truncated: the header remains a WebP header, so the driver is chosen, and it is
            // the size `RIFF` announces — larger than the file — that stops the read.
            ("tronque.webp", "image-decode-failed"),
        ],
    );
    // The lossy stream without an extended container — the file's first chunk — follows the
    // same path.
    let mut nu = fixture("webp", "sans-perte.webp");
    nu[12..16].copy_from_slice(b"VP8 ");
    assert_eq!(
        registry::decode(&nu, MAX_ALLOC).err(),
        Some("image-lossy-unsupported")
    );
    // A whole container but with no image stream: twelve header bytes and nothing behind.
    assert_eq!(
        registry::decode(b"RIFF\x04\x00\x00\x00WEBP", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
    // The allocation ceiling is a limit, not a suggestion: above it, it is a refusal, and it
    // carries its name — the final RGBA8 size is known before anything is decoded.
    assert_eq!(
        registry::decode(&fixture("webp", "sans-perte.webp"), MAX_ALLOC_TROP_PETIT).err(),
        Some("image-too-large")
    );
    // RIFF serves other formats: without the `WEBP` form type, the driver claims nothing, and
    // these bytes come out as an unknown format rather than as an unreadable WebP.
    for head in [
        b"RIFF\x24\x00\x00\x00WAVEfmt ".as_slice(),
        b"RIFF\x24\x00\x00",
    ] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
