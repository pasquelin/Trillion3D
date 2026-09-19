//! Golden of the PNG driver: depth decides, and it decides before decoding. Up to eight bits
//! per channel the image comes out pixel for pixel; at sixteen it is refused by naming it, like
//! 16-bit TIFF and for the same reason — the contract output cannot carry that precision yet,
//! and clipping it in silence would add a loss the source did not have.
use super::super::image as registry;
use super::{declared, fixture, rgba8};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Reference image, 2 × 2 pixels, top row first. The three fixtures carry this same drawing,
/// each at a different depth.
const REFERENCE: [[u8; 4]; 4] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
];

// PNG driver golden: the depths it reads — eight bits per channel, and below that the four-bit
// palette — yield the same image, pixel for pixel. A depth is a way of writing the image, never
// of changing it, and the 16-bit refusal has not changed that.
#[test]
fn each_read_depth_yields_the_reference_pixels() {
    for name in ["rgb8.png", "palette4.png"] {
        let bytes = fixture("png", name);
        let pilote = registry::by_head(&bytes).expect("a driver claims these bytes");
        assert_eq!(pilote.name(), "png", "{name}");
        assert_eq!(pilote.mime(), "image/png", "{name}");
        let rendu = rgba8(
            registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{name}: {erreur}")),
        );
        assert_eq!((rendu.width(), rendu.height()), (2, 2), "{name}");
        assert_eq!(
            rendu.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
            REFERENCE,
            "{name}"
        );
    }
}

// Driver contract: a 16-bit-per-channel PNG is refused under its own reason, read in the IHDR
// before any decoding. Yielding it lowered to eight bits would add a loss the source did not
// have; the refusal, for its part, simply lets the engine fall back on its white and never
// panics.
#[test]
fn a_sixteen_bit_png_comes_out_as_a_report_reason_never_clipped() {
    let bytes = fixture("png", "rgb16.png");
    assert_eq!(
        registry::by_head(&bytes).map(|pilote| pilote.name()),
        Some("png")
    );
    assert_eq!(
        registry::decode(&bytes, MAX_ALLOC).err(),
        Some("image-depth-unsupported")
    );
    // This refusal changed what the driver produces, so its cache identity: the version
    // carries it, otherwise an entry written in the silent-lowering days would be reread as
    // correct.
    assert_eq!(
        registry::by_head(&bytes).map(|pilote| pilote.version()),
        Some("png-image-0.25-depth8-apng-icc-gama")
    );
    // It is depth that refuses, not size: the reason does not move with the allocation
    // ceiling, and it comes out without a single pixel having been decoded.
    assert_eq!(
        registry::decode(&bytes, 16).err(),
        Some("image-depth-unsupported")
    );
    // A file too short to carry its IHDR is not judged on its depth: it stays judged by the
    // decoder, exactly as before this refusal.
    assert_eq!(
        registry::decode(b"\x89PNG\r\n\x1a\ntronque", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
}

// Reproduction of finding 8: an APNG carries several images, the contract yields only one. The
// first comes out as-is — it is the default image the APNG specification places in `IDAT` —,
// and the file having declared an animation by its `acTL` chunk, the driver counts it.
// Flattening without saying so let two images in and only one out, without a word in the
// report.
#[test]
fn an_animated_png_yields_its_default_image_and_counts_the_animation() {
    let bytes = fixture("png", "anime.png");
    let rendu = rgba8(
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("anime.png: {erreur}")),
    );
    assert_eq!((rendu.width(), rendu.height()), (2, 2));
    // The default image is pure red; the second frame, green, does not enter the output.
    assert_eq!(
        rendu.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
        vec![[255, 0, 0, 255]; 4]
    );
    let (transfert, raisons) = declared("png", "anime.png", MAX_ALLOC);
    assert_eq!(transfert, registry::Transfer::Srgb);
    assert_eq!(raisons, vec!["image-animation-first-frame"]);
    // A one-image PNG does not carry `acTL`: it counts nothing.
    assert!(declared("png", "rgb8.png", MAX_ALLOC).1.is_empty());
}

/// The same fixture, one more chunk slipped in front of its `IDAT` — the place the
/// specification gives to `gAMA`, `sRGB` and `iCCP`. The CRC is recomputed: a false chunk
/// would be refused, and that is not what these cases put to the test.
fn with_chunk(name: &str, kind: &[u8], data: &[u8]) -> Vec<u8> {
    inserted(&fixture("png", name), kind, data)
}

/// The same, on bytes already in hand: that is how a case places two chunks.
fn inserted(bytes: &[u8], kind: &[u8], data: &[u8]) -> Vec<u8> {
    let at = bytes
        .windows(4)
        .position(|window| window == b"IDAT")
        .expect("IDAT")
        - 4;
    let mut crc = flate2::Crc::new();
    crc.update(kind);
    crc.update(data);
    let mut out = bytes[..at].to_vec();
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc.sum().to_be_bytes());
    out.extend_from_slice(&bytes[at..]);
    out
}

/// `gAMA` chunk of a gamma written in hundred-thousandths, as the format does.
fn gamma(hundred_thousandths: u32) -> Vec<u8> {
    hundred_thousandths.to_be_bytes().to_vec()
}

/// What the driver declares around the pixels of these bytes.
fn declares(bytes: &[u8]) -> (registry::Transfer, Vec<&'static str>) {
    let decoded = registry::decode(bytes, MAX_ALLOC).expect("decoded");
    (decoded.transfer, decoded.notes)
}

// Reproduction of finding A12: a PNG that declares `gAMA = 100000` says a gamma of 1, so
// samples proportional to light — the PNG specification writes it. The driver nevertheless
// yielded `Srgb` without a word, and the preview chain decoded a second time an already linear
// image. The declared curve is now carried, under a fixed priority: `iCCP`, then the `sRGB`
// chunk, then `gAMA`.
#[test]
fn the_curve_declared_by_the_chunks_is_carried_by_the_contract() {
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(100_000))),
        (registry::Transfer::Linear, vec![]),
        "a gamma of 1 says linear samples"
    );
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(45_455))),
        (registry::Transfer::Srgb, vec![]),
        "a gamma of 1/2.2 is that of the sRGB curve"
    );
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"sRGB", &[0])),
        (registry::Transfer::Srgb, vec![]),
        "the sRGB chunk says the output curve"
    );
    // A gamma the contract cannot carry: the image comes out treated as sRGB, as convention
    // wants for a silent file, and the mismatch is counted by name.
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(50_000))),
        (registry::Transfer::Srgb, vec!["image-transfer-unsupported"]),
        "an unusual curve is counted"
    );
    // Priority: an `sRGB` chunk wins over `gAMA`, an `iCCP` profile over both — it is that
    // which describes the curve, and it is already counted as unconverted.
    let tagged = with_chunk("rgb8.png", b"sRGB", &[0]);
    assert_eq!(
        declares(&inserted(&tagged, b"gAMA", &gamma(100_000))).0,
        registry::Transfer::Srgb,
        "the sRGB chunk wins over gAMA"
    );
    assert_eq!(
        declares(&with_chunk("icc-autre.png", b"gAMA", &gamma(100_000))),
        (registry::Transfer::Srgb, vec!["image-icc-profile-ignored"]),
        "a colour profile wins over gAMA, and stays counted alone"
    );
    // A file that declares nothing keeps the curve convention assigns it.
    assert_eq!(
        declares(&fixture("png", "rgb8.png")),
        (registry::Transfer::Srgb, vec![])
    );
}
