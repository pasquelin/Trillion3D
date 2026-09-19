//! What a KTX 2.0 **declares** around its texels: the transfer function of its format
//! descriptor, and the keys of its key-value section. The driver did not read them at all.
//!
//! Containers of these cases are written field by field by `bytes::described`: a single
//! payload, and the declaration alone that changes from one case to the other.
use super::super::super::image as registry;
use super::{bytes, MAX_ALLOC, RGBA8_SRGB, SIDE};

/// `KHR_DF_TRANSFER_LINEAR` and `KHR_DF_TRANSFER_SRGB`, the two values the driver recognises;
/// zero is `KHR_DF_TRANSFER_UNSPECIFIED`, which the file leaves undetermined.
const LINEAR: u8 = 1;
const SRGB: u8 = 2;
const UNSPECIFIED: u8 = 0;
/// `VK_FORMAT_R8G8B8A8_UNORM`, the linear twin of `RGBA8_SRGB`.
const RGBA8_UNORM: u32 = 37;
/// Sixteen texels of a 4 × 4 RGBA8 level: an arbitrary payload, the same everywhere.
fn level() -> Vec<u8> {
    (0..64u16).map(|value| value as u8).collect()
}

/// What this container declares, and the bytes of its image.
fn declared(case: &str, file: &[u8]) -> (registry::Transfer, Vec<&'static str>, Vec<u8>) {
    let decoded =
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case} : {reason}"));
    let (transfer, notes) = (decoded.transfer, decoded.notes.clone());
    (transfer, notes, super::super::rgba8(decoded).into_raw())
}

// Reproduction of finding 56, KTX 2.0 half: the same payload, its format descriptor declaring a
// linear then sRGB transfer function. Texels are the same and the declaration changes; the
// driver previously assigned sRGB to both, so a linear texture was reread as if it carried the
// curve.
#[test]
fn the_same_level_declared_linear_then_srgb_yields_two_transfers() {
    let level = level();
    let file =
        |transfer| bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, Some((transfer, 0)), &[]);
    let (linear, _, pixels) = declared("linear dfd", &file(LINEAR));
    let (srgb, _, same) = declared("sRGB dfd", &file(SRGB));
    assert_eq!(pixels, same, "the codec is the same, so are the bytes");
    assert_eq!(linear, registry::Transfer::Linear);
    assert_eq!(srgb, registry::Transfer::Srgb);
}

// Driver contract: without a descriptor, or when it leaves the transfer function undetermined,
// it is `vkFormat` that names it — the Vulkan registry publishes each codec as `_UNORM` and
// `_SRGB`. Outside those two paths, convention assigns sRGB.
#[test]
fn vkformat_names_the_transfer_when_the_descriptor_is_silent() {
    let level = level();
    for (case, format, dfd, expected) in [
        (
            "no descriptor, _SRGB",
            RGBA8_SRGB,
            None,
            registry::Transfer::Srgb,
        ),
        (
            "no descriptor, _UNORM",
            RGBA8_UNORM,
            None,
            registry::Transfer::Linear,
        ),
        (
            "silent descriptor, _UNORM",
            RGBA8_UNORM,
            Some((UNSPECIFIED, 0)),
            registry::Transfer::Linear,
        ),
    ] {
        let file = bytes::described(format, SIDE, SIDE, &level, 1, dfd, &[]);
        assert_eq!(declared(case, &file).0, expected, "{case}");
    }
}

/// `KHR_DF_FLAG_ALPHA_PREMULTIPLIED`, the first bit of the basic-block flags.
const PREMULTIPLIED: u8 = 1;

/// A 4 × 4 RGBA8 level whose each line carries a different value: enough to see a vertical
/// flip. `line` gives the quadruplet of the line.
fn rows(line: impl Fn(usize) -> [u8; 4]) -> Vec<u8> {
    (0..4).flat_map(|row| line(row).repeat(4)).collect()
}

// Reproduction of finding 57: the format descriptor raises the premultiplied-alpha flag, and
// the output contract asks for straight alpha. The driver did not read that flag: colours
// already multiplied by their alpha came out as-is, then the preview premultiplied them a
// second time. Each component is now divided by the texel's alpha, without dividing by zero.
#[test]
fn the_descriptor_premultiplied_flag_brings_alpha_back_to_straight() {
    // Line 0: a half-grey premultiplied at half alpha, which is a straight white. Line 1: a
    // black, which stays black. Line 2: a zero alpha, under which there is no straight colour
    // to recover. Line 3: an opaque texel, which the division leaves exactly as-is.
    let level = rows(|row| match row {
        0 => [128, 128, 128, 128],
        1 => [0, 0, 0, 128],
        2 => [10, 20, 30, 0],
        _ => [7, 8, 9, 255],
    });
    let file = bytes::described(
        RGBA8_SRGB,
        SIDE,
        SIDE,
        &level,
        1,
        Some((SRGB, PREMULTIPLIED)),
        &[],
    );
    let attendu = rows(|row| match row {
        0 => [255, 255, 255, 128],
        1 => [0, 0, 0, 128],
        2 => [10, 20, 30, 0],
        _ => [7, 8, 9, 255],
    });
    let (_, notes, pixels) = declared("premultiplied", &file);
    assert_eq!(pixels, attendu);
    assert!(notes.is_empty(), "the flag is applied, not counted");
    // Without the flag, the same bytes come out as-is: it is indeed it that decides.
    let droit = bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, Some((SRGB, 0)), &[]);
    assert_eq!(declared("straight", &droit).2, level);
}

// Reproduction of finding 57, second half: the `KTXorientation` and `KTXswizzle` keys were
// ignored without a word. The format's default orientation is `rd` — to the right, downward —,
// that of the contract; `ru` asks for a vertical flip, which the driver applies. Everything
// else is counted by name, never applied the wrong way.
#[test]
fn orientation_and_swizzle_keys_are_applied_or_counted() {
    let level = rows(|row| [row as u8 * 10, 0, 0, 255]);
    let file =
        |keys: &[(&str, &str)]| bytes::described(RGBA8_SRGB, SIDE, SIDE, &level, 1, None, keys);
    // `rd` is the contract orientation: nothing moves, nothing is counted.
    let (_, notes, pixels) = declared("rd", &file(&[("KTXorientation", "rd")]));
    assert_eq!(pixels, level);
    assert!(notes.is_empty());
    // `ru` writes its lines from the bottom up: the driver puts them back in contract order.
    let (_, notes, pixels) = declared("ru", &file(&[("KTXorientation", "ru")]));
    assert_eq!(pixels, rows(|row| [(3 - row) as u8 * 10, 0, 0, 255]));
    assert!(notes.is_empty(), "a flip applies, it is not counted");
    // An orientation that goes left would ask for a horizontal flip the driver does not
    // declare: it is counted, and texels stay where the file put them.
    let (_, notes, pixels) = declared("lu", &file(&[("KTXorientation", "lu")]));
    assert_eq!(pixels, level);
    assert_eq!(notes, vec!["ktx2-orientation-unsupported"]);
    // A channel permutation other than identity is counted the same way.
    let (_, notes, pixels) = declared("bgra", &file(&[("KTXswizzle", "bgra")]));
    assert_eq!(pixels, level);
    assert_eq!(notes, vec!["ktx2-swizzle-unsupported"]);
    // `rgba` is identity: it counts nothing.
    assert!(declared("rgba", &file(&[("KTXswizzle", "rgba")]))
        .1
        .is_empty());
}
