//! Golden of the PNG driver: up to eight bits per channel the image comes out pixel for pixel; at
//! sixteen it comes out rounded to eight bits and the reduction is counted.
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
// of changing it.
#[test]
fn each_read_depth_yields_the_reference_pixels() {
    for name in ["rgb8.png", "palette4.png"] {
        let bytes = fixture("png", name);
        let driver = registry::by_head(&bytes).expect("a driver claims these bytes");
        assert_eq!(driver.name(), "png", "{name}");
        assert_eq!(driver.mime(), "image/png", "{name}");
        let rendered = rgba8(
            registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|error| panic!("{name}: {error}")),
        );
        assert_eq!((rendered.width(), rendered.height()), (2, 2), "{name}");
        assert_eq!(
            rendered.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
            REFERENCE,
            "{name}"
        );
    }
}

// Driver contract: a 16-bit-per-channel PNG is read, each sample rounded to the nearest of 256
// values, its 16-bit samples kept beside the bytes, and counted under its own reason, read in the
// IHDR. A file too short to carry its IHDR
// is not judged on its depth.
#[test]
fn a_sixteen_bit_png_comes_out_rounded_and_counted() {
    let bytes = fixture("png", "rgb16.png");
    assert_eq!(
        registry::by_head(&bytes).map(|driver| driver.name()),
        Some("png")
    );
    let decoded = registry::decode(&bytes, MAX_ALLOC).expect("rgb16.png");
    let wide = decoded.wide.clone().expect("the 16-bit samples ride along");
    let rendered = rgba8(decoded);
    assert_eq!(wide.len(), rendered.as_raw().len());
    assert!(wide
        .iter()
        .zip(rendered.as_raw())
        .all(|(&v, &byte)| (u32::from(v) + 128) / 257 == u32::from(byte)));
    // The fixture writes each byte of the drawing as a word (`byte × 256`): rounding to the
    // nearest of 256 values lands within one of it.
    for (pixel, wanted) in rendered.pixels().zip(REFERENCE) {
        assert!(pixel.0.iter().zip(wanted).all(|(&a, b)| a.abs_diff(b) <= 1));
    }
    assert_eq!(
        declared("png", "rgb16.png", MAX_ALLOC).1,
        vec!["image-depth-reduced"]
    );
    // The version carries the rule, so a cache written when the chain was reduced from bytes is
    // not reread.
    assert_eq!(
        registry::by_head(&bytes).map(|driver| driver.version()),
        Some("png-image-0.25-depth16-chain-apng-icc-gama")
    );
    assert_eq!(
        registry::decode(b"\x89PNG\r\n\x1a\ntruncated", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
}

// An APNG carries several images, the contract yields only one. The
// first comes out as-is — it is the default image the APNG specification places in `IDAT` —,
// and the file having declared an animation by its `acTL` chunk, the driver counts it.
// Flattening without saying so let two images in and only one out, without a word in the
// report.
#[test]
fn an_animated_png_yields_its_default_image_and_counts_the_animation() {
    let bytes = fixture("png", "animated.png");
    let rendered = rgba8(
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|error| panic!("animated.png: {error}")),
    );
    assert_eq!((rendered.width(), rendered.height()), (2, 2));
    // The default image is pure red; the second frame, green, does not enter the output.
    assert_eq!(
        rendered.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
        vec![[255, 0, 0, 255]; 4]
    );
    let (transfert, raisons) = declared("png", "animated.png", MAX_ALLOC);
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

// A PNG that declares `gAMA = 100000` says a gamma of 1, so
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
        declares(&with_chunk("icc-other.png", b"gAMA", &gamma(100_000))),
        (registry::Transfer::Srgb, vec!["image-icc-profile-ignored"]),
        "a colour profile wins over gAMA, and stays counted alone"
    );
    // A file that declares nothing keeps the curve convention assigns it.
    assert_eq!(
        declares(&fixture("png", "rgb8.png")),
        (registry::Transfer::Srgb, vec![])
    );
}
