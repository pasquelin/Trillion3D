//! Golden of the DDS driver: each declared codec, decoded from a container written byte by byte
//! in `bytes.rs`, must yield exactly the RGBA8 pixels written in the open here. Reference
//! values come from the specification, not from the decoder: integer interpolation of BCn
//! blocks is set by hand, so a decoder that would round otherwise would show immediately.
//!
//! Two real files of the corpus complete the golden: a 256 × 256 BC1 with nine levels, which
//! proves that a third-party encoder's header is read and that the mip chain is counted, and a
//! truncated DDS, which proves that a cut file comes out as a report reason.
use super::super::image as registry;

mod bytes;
mod refus;
mod sans_compression;
mod transfert;

const MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// BCn blocks cover 4 × 4 pixels: the golden places exactly one per codec.
const SIDE: u32 = 4;

/// Colour indices, one per pixel: each line shifts by one, so the four colours of the block
/// appear in the four lines and no position is privileged.
const ORDER: [u8; 16] = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
/// Indices of a three-bit ramp: the eight values, twice.
const RAMP: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
/// BC2 four-bit alpha indices, expanded by the specification as `v << 4 | v`.
const NIBBLES: [u8; 16] = [15, 0, 8, 4, 0, 8, 4, 15, 8, 4, 15, 0, 4, 15, 0, 8];

/// Four colours of the golden's BC1 block. The bounds are pure red `0xf800` and pure blue
/// `0x001f` in 565; `colour0 > colour1`, so the two middle colours are the integer thirds the
/// specification defines: (2·c0 + c1)/3 then (c0 + 2·c1)/3.
const COLORS: [[u8; 3]; 4] = [[255, 0, 0], [0, 0, 255], [170, 0, 85], [85, 0, 170]];
/// Alpha ramp of bounds 255 and 0: `bound0 > bound1`, so the six integer sevenths.
const ALPHA: [u8; 8] = [255, 0, 218, 182, 145, 109, 72, 36];
/// Ramp of bounds 200 and 100, on BC5's second channel.
const GREEN: [u8; 8] = [200, 100, 185, 171, 157, 142, 128, 114];

/// Decodes a container through the registry and compares its pixels, one by one, to the
/// reference.
fn check(case: &str, file: &[u8], expected: &[[u8; 4]]) {
    let decoder = registry::by_head(file).expect("a driver claims these bytes");
    assert_eq!(decoder.name(), "dds", "{case}");
    let image = super::rgba8(
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case}: {reason}")),
    );
    assert_eq!((image.width(), image.height()), (SIDE, SIDE), "{case}");
    assert_eq!(
        image.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
        expected,
        "{case}"
    );
}

/// Colours of the BC1 block, opaque: what BC1, BC2 and BC3 yield for their RGB channels.
fn colors() -> Vec<[u8; 4]> {
    ORDER
        .iter()
        .map(|index| {
            let [red, green, blue] = COLORS[*index as usize];
            [red, green, blue, 255]
        })
        .collect()
}

/// Golden's BC7 block, in mode 6: two seven-bit RGBA bounds plus a P bit, then the four-bit
/// indices — three only for the first pixel, whose high bit the specification implies. Indices
/// 0 and 15 fall on weights 0 and 64, so exactly on a bound: no interpolation enters the
/// reference.
fn bc7_block() -> [u8; 16] {
    let mut bits = bytes::Bits::new();
    bits.put(0, 6).put(1, 1);
    for value in [127, 0, 0, 127, 0, 0, 127, 63] {
        bits.put(value, 7);
    }
    bits.put(0, 1).put(0, 1).put(0, 3);
    for pixel in 1..16 {
        bits.put(if pixel % 2 == 1 { 15 } else { 0 }, 4);
    }
    bits.block()
}

// DDS driver golden: the six compressed codecs the driver declares yield, pixel by pixel, the
// specification's integer reconstruction. Lossless means: not one extra byte.
#[test]
fn each_declared_compressed_codec_yields_the_reference_pixels() {
    let colors = colors();
    let color_block = bytes::color_block(ORDER);
    let red = bytes::ramp_block(255, 0, RAMP);
    let mut bc2 = bytes::indices(NIBBLES, 4);
    bc2.extend_from_slice(&color_block);
    let mut bc3 = red.clone();
    bc3.extend_from_slice(&color_block);
    let mut bc5 = red.clone();
    bc5.extend_from_slice(&bytes::ramp_block(200, 100, RAMP));
    let with_alpha = |source: &[u8; 16], table: &[u8]| -> Vec<[u8; 4]> {
        colors
            .iter()
            .zip(source)
            .map(|([red, green, blue, _], index)| [*red, *green, *blue, table[*index as usize]])
            .collect()
    };
    let expanded: Vec<u8> = NIBBLES.iter().map(|value| value << 4 | value).collect();
    let nibble_alpha: Vec<[u8; 4]> = colors
        .iter()
        .zip(&expanded)
        .map(|([red, green, blue, _], alpha)| [*red, *green, *blue, *alpha])
        .collect();
    for (case, tag, payload, expected) in [
        ("bc1", b"DXT1", color_block.clone(), colors.clone()),
        ("bc2", b"DXT3", bc2, nibble_alpha),
        ("bc3", b"DXT5", bc3, with_alpha(&RAMP, &ALPHA)),
        (
            "bc4",
            b"ATI1",
            red.clone(),
            RAMP.map(|index| [ALPHA[index as usize], 0, 0, 255])
                .to_vec(),
        ),
        (
            "bc5",
            b"ATI2",
            bc5,
            RAMP.map(|index| [ALPHA[index as usize], GREEN[index as usize], 0, 255])
                .to_vec(),
        ),
    ] {
        let file = bytes::container(bytes::fourcc_format(tag), SIDE, SIDE, 1, &payload);
        check(case, &file, &expected);
    }
    // BC7 has no `dwFourCC`: it is named only by the `dxgiFormat` of the DX10 header.
    let bc7: Vec<[u8; 4]> = (0..16)
        .map(|pixel| {
            if pixel % 2 == 0 {
                [254, 0, 0, 254]
            } else {
                [0, 254, 0, 126]
            }
        })
        .collect();
    check("bc7", &bytes::dx10(98, SIDE, SIDE, &bc7_block()), &bc7);
    // The same blocks named by DX10 rather than by `dwFourCC` yield the same pixels.
    check(
        "dxgi bc1",
        &bytes::dx10(71, SIDE, SIDE, &color_block),
        &colors,
    );
}
