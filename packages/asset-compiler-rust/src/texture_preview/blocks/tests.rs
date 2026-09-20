//! The blocks are proved against an independent decoder: `texture2ddecoder`,
//! which reconstructs BC7 and ASTC by the specification and shares no line with
//! the writers here. What it reads back bounds the loss, format by format.
use super::*;

fn decode(bytes: &[u8], width: u32, height: u32, format: BlockFormat) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let mut pixels = vec![0u32; w * h];
    match format {
        BlockFormat::Bc7 => texture2ddecoder::decode_bc7(bytes, w, h, &mut pixels),
        BlockFormat::Astc => texture2ddecoder::decode_astc_4_4(bytes, w, h, &mut pixels),
    }
    .expect("decodable");
    pixels
        .iter()
        .flat_map(|p| {
            let [b, g, r, a] = p.to_le_bytes();
            [r, g, b, a]
        })
        .collect()
}

fn psnr(a: &[u8], b: &[u8]) -> f64 {
    let mse = a
        .iter()
        .zip(b)
        .map(|(&x, &y)| (f64::from(x) - f64::from(y)).powi(2))
        .sum::<f64>()
        / a.len() as f64;
    if mse == 0.0 {
        f64::INFINITY
    } else {
        10.0 * (255.0f64 * 255.0 / mse).log10()
    }
}

/// A textured image the way a photograph is: one luminance relief shared by the
/// three colours, a faint grain over it, an alpha ramp. Channels that vary
/// independently — one gradient per channel — describe a plane a single segment
/// cannot hold, and a block of them costs ten decibels more in every codec.
fn photo(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let relief = 128.0 + 70.0 * (x as f32 / 5.0).sin() * (y as f32 / 7.0).cos();
            let grain = ((x * 7 + y * 13) % 5) as f32 - 2.0;
            let channel = |scale: f32| (relief * scale + grain).clamp(0.0, 255.0) as u8;
            rgba.extend([
                channel(1.0),
                channel(0.8),
                channel(0.55),
                (255 - (y * 40 / height)) as u8,
            ]);
        }
    }
    rgba
}

fn constant(rgba: [u8; 4]) -> Vec<u8> {
    rgba.repeat(16)
}

// Behaviour: a constant block whose bytes every channel can carry decodes
// exactly, in both formats — the fit costs nothing on a flat colour.
#[test]
fn flat_blocks_decode_exactly_where_the_range_holds_the_byte() {
    for (format, colour) in [
        (BlockFormat::Bc7, [200u8, 100, 50, 254]),
        (BlockFormat::Bc7, [201, 101, 51, 255]),
        (
            BlockFormat::Astc,
            [ise::unquantise(70), ise::unquantise(3), 0, 255],
        ),
    ] {
        let block = encode_level(&constant(colour), 4, 4, format);
        assert_eq!(block.len(), BLOCK_BYTES);
        assert_eq!(decode(&block, 4, 4, format), constant(colour), "{format:?}");
    }
}

// Behaviour: the 192-level endpoint range, packed with trits, decodes through an
// independent reader to the level nearest each byte — every byte of the range.
#[test]
fn astc_endpoints_reach_every_level_of_their_range() {
    let mut seen = std::collections::BTreeSet::new();
    for byte in 0..=255u8 {
        let expected = ise::unquantise(ise::quantise(f32::from(byte)));
        assert!(
            u8::abs_diff(expected, byte) <= 2,
            "byte {byte} → {expected}"
        );
        let block = encode_level(&constant([byte, byte, byte, byte]), 4, 4, BlockFormat::Astc);
        assert_eq!(
            decode(&block, 4, 4, BlockFormat::Astc)[0],
            expected,
            "byte {byte}"
        );
        seen.insert(expected);
    }
    assert_eq!(seen.len(), ise::LEVELS);
}

// Behaviour: on a textured image the loss stays bounded — the batch's declared
// pixel cost — and every level of odd size pads by whole blocks.
#[test]
fn textured_levels_decode_within_the_declared_loss() {
    for (format, floor) in [(BlockFormat::Bc7, 38.0), (BlockFormat::Astc, 38.0)] {
        for (width, height) in [(64u32, 48u32), (13, 7), (1, 1), (2, 130)] {
            let source = photo(width, height);
            let level = encode_level(&source, width, height, format);
            assert_eq!(level.len(), level_block_bytes(width, height));
            let quality = psnr(&decode(&level, width, height, format), &source);
            assert!(
                quality >= floor,
                "{format:?} {width}×{height}: {quality:.1} dB"
            );
        }
    }
}

// Behaviour: the same bytes in, the same bytes out — the cache key rests on it.
#[test]
fn encoding_is_deterministic() {
    let source = photo(32, 32);
    for format in BlockFormat::ALL {
        let once = encode_level(&source, 32, 32, format);
        assert_eq!(once, encode_level(&source, 32, 32, format));
        assert_eq!(once.len(), 64 * BLOCK_BYTES);
    }
}

// Behaviour: the engine fills slot 0 of a block pool with one constant block per
// format — mirror of `WHITE_BLOCK` in `packages/sdk-browser/textureBlockFormats.ts`
// — and an independent decoder reads both as opaque white: BC7 mode 6 with every
// endpoint at its maximum, ASTC a void-extent block of 16-bit ones.
#[test]
fn the_white_blocks_the_engine_pins_decode_to_opaque_white() {
    let bc7 = [
        0xC0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01, 0, 0, 0, 0, 0, 0, 0,
    ];
    let astc = [
        0xFC, 0xFD, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF,
    ];
    for (format, block) in [(BlockFormat::Bc7, bc7), (BlockFormat::Astc, astc)] {
        assert_eq!(
            decode(&block, 4, 4, format),
            constant([255; 4]),
            "{format:?}"
        );
    }
}

// Behaviour: the three-rung search of `nearest_rung` is exact on both ladders —
// what a full search over every rung would choose, for every position.
#[test]
fn the_nearest_rung_shortcut_matches_a_full_search_on_both_ladders() {
    for ladder in [
        [
            0u8, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64,
        ]
        .to_vec(),
        [0u8, 9, 18, 27, 37, 46, 55, 64].to_vec(),
    ] {
        let rungs: Vec<f32> = ladder.iter().map(|&w| f32::from(w) / 64.0).collect();
        for step in -50..=1050 {
            let t = step as f32 / 1000.0;
            let texels = [[t * 255.0, 0.0, 0.0, 0.0]; 16];
            let full = rungs
                .iter()
                .enumerate()
                .min_by(|a, b| (a.1 - t).abs().partial_cmp(&(b.1 - t).abs()).unwrap())
                .unwrap()
                .0 as u8;
            let got = fit::assign(&texels, &rungs, [0.0; 4], [255.0, 0.0, 0.0, 0.0])[0];
            assert!(
                (rungs[got as usize] - t).abs() <= (rungs[full as usize] - t).abs() + 1e-6,
                "t = {t}: shortcut {got}, full {full}"
            );
        }
    }
}
