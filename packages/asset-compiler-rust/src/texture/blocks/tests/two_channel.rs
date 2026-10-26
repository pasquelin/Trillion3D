//! The two-channel layouts — BC5 and the ASTC luminance-alpha block on two
//! weight planes — proved on the same independent decoder: X comes back in R,
//! Y in G, whichever the family, and Z as the shader rebuilds it.
use super::{constant, psnr};
use crate::texture::blocks::*;

fn decoded(rgba: &[u8], width: u32, height: u32, format: BlockFormat) -> Vec<u8> {
    let level = encode_level(
        rgba,
        width,
        height,
        format,
        Layout::TwoChannel,
        Effort::Fast,
    );
    assert_eq!(level.len(), level_block_bytes(width, height));
    crate::texture::blocks::decode::decode_level(&level, width, height, format, Layout::TwoChannel)
        .expect("decodable")
}

/// A normal map whose X and Y vary in directions of their own: what one RGBA
/// segment cannot hold and two ladders can.
pub(crate) fn normals(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let nx = 0.7 * (x as f32 / 6.0).sin();
            let ny = 0.7 * (y as f32 / 10.0).cos();
            let nz = (1.0 - nx * nx - ny * ny).max(0.0).sqrt();
            let byte = |v: f32| ((v + 1.0) * 127.5).round() as u8;
            rgba.extend([byte(nx), byte(ny), byte(nz), 255]);
        }
    }
    rgba
}

// Behaviour: a flat block decodes to its exact X and Y in both families — the
// endpoints are whole bytes — with Z rebuilt from them and an opaque alpha.
#[test]
fn flat_two_channel_blocks_decode_exactly() {
    for format in BlockFormat::ALL {
        for (x, y) in [(200u8, 100u8), (0, 255), (128, 128), (37, 37)] {
            let block = decoded(&constant([x, y, 9, 77]), 4, 4, format);
            assert_eq!(
                block,
                constant([x, y, crate::texture::blocks::decode::rebuilt_z(x, y), 255]),
                "{format:?} ({x}, {y})"
            );
        }
    }
}

// Behaviour: on a normal map whose channels vary independently, the two-channel
// layout reads back far above one RGBA segment (BC7 mode 6, ASTC CEM 12): BC5's
// eight rungs per channel above the gate, the ASTC block's five quint rungs —
// the most its 128 bits hold beside four eight-bit endpoints — two decibels
// under it, which is why an ASTC normal map more often stays lossless. Odd
// sizes pad by whole blocks.
#[test]
fn independent_channels_read_back_above_the_gate_on_two_ladders() {
    for (format, floor) in [
        (BlockFormat::Bc7, crate::texture::blocks::quality::GATE_DB),
        (
            BlockFormat::Astc,
            crate::texture::blocks::quality::GATE_DB - 2.5,
        ),
    ] {
        for (width, height) in [(64u32, 48u32), (13, 7), (1, 1), (2, 130)] {
            let source = normals(width, height);
            let xyz = |rgba: &[u8]| -> Vec<u8> {
                rgba.chunks(4).flat_map(|t| [t[0], t[1], t[2]]).collect()
            };
            let two = psnr(
                &xyz(&decoded(&source, width, height, format)),
                &xyz(&source),
            );
            assert!(
                two >= floor,
                "{format:?} {width}×{height}: two channels {two:.1} dB"
            );
        }
        let source = normals(64, 64);
        let one = encode_level(&source, 64, 64, format, Layout::Rgba, Effort::Fast);
        let one = psnr(
            &crate::texture::blocks::decode::decode_level(&one, 64, 64, format, Layout::Rgba)
                .expect("decodable"),
            &source,
        );
        let two = psnr(&decoded(&source, 64, 64, format), &source);
        assert!(
            two > one + 6.0,
            "{format:?}: RGBA {one:.1} dB, two channels {two:.1} dB"
        );
    }
}

// Behaviour: every quint triple packs to seven bits the specification's decode
// gives back, and a triple whose last value is zero packs on its five low bits —
// what a group short of three values keeps.
#[test]
fn quint_packing_round_trips_and_leaves_a_short_group_its_low_bits() {
    let mut seen = std::collections::BTreeSet::new();
    for q0 in 0..5u8 {
        for q1 in 0..5u8 {
            for q2 in 0..5u8 {
                let packed = crate::texture::blocks::ise::packed_quints([q0, q1, q2]);
                assert!(packed < 128);
                assert!(seen.insert(packed), "({q0}, {q1}, {q2}) packs like another");
                if q2 == 0 {
                    assert_eq!(packed >> 5, 0, "({q0}, {q1}, 0) → {packed:#b}");
                }
            }
        }
    }
    assert_eq!(seen.len(), 125);
}

// Behaviour: the block's Z is what the shader computes — unit length from X and
// Y, clamped where the pair already exceeds it — so the gate measures the
// normal the image will shade with.
#[test]
fn z_is_rebuilt_as_the_shader_rebuilds_it() {
    assert_eq!(crate::texture::blocks::decode::rebuilt_z(128, 128), 255);
    assert_eq!(crate::texture::blocks::decode::rebuilt_z(255, 128), 128);
    assert_eq!(crate::texture::blocks::decode::rebuilt_z(255, 255), 128);
    assert_eq!(crate::texture::blocks::decode::rebuilt_z(0, 0), 128);
    assert_eq!(crate::texture::blocks::decode::rebuilt_z(191, 128), 238);
}

// Behaviour: a one-channel level is BC4 blocks of eight bytes holding the first channel — the
// independent decoder gives back a flat block exactly and a ramp within the gate's bar — and the
// level is half the bytes of a sixteen-byte layout.
#[test]
fn one_channel_blocks_are_bc4_of_the_first_channel() {
    use texture2ddecoder::decode_bc4_block;
    let flat = encode_one_channel(&constant([77, 200, 3, 255]), 4, 4);
    assert_eq!(flat.len(), Layout::OneChannel.block_bytes());
    let mut words = [0u32; 16];
    decode_bc4_block(&flat, &mut words);
    assert!(words.iter().all(|w| w.to_le_bytes()[2] == 77), "{words:?}");
    let ramp: Vec<u8> = (0..16 * 16)
        .flat_map(|at| [(at % 16 * 16 + at / 16) as u8, 0, 0, 255])
        .collect();
    let level = encode_one_channel(&ramp, 16, 16);
    assert_eq!(level.len(), level_block_bytes(16, 16) / 2);
    let mut red = Vec::new();
    for block in level.chunks_exact(8) {
        decode_bc4_block(block, &mut words);
        red.extend(words.iter().map(|w| w.to_le_bytes()[2]));
    }
    let source: Vec<u8> = (0..16 * 16).map(|at| ramp[at * 4]).collect();
    // Blocks come back block by block: compare in the same order.
    let in_blocks: Vec<u8> = (0..16 * 16)
        .map(|i| {
            let (block, texel) = (i / 16, i % 16);
            let (x, y) = (block % 4 * 4 + texel % 4, block / 4 * 4 + texel / 4);
            source[y * 16 + x]
        })
        .collect();
    let worst = red
        .iter()
        .zip(&in_blocks)
        .map(|(a, b)| a.abs_diff(*b))
        .max();
    // Eight rungs across the block's range: half a rung off at most.
    assert!(worst <= Some(4), "worst gap {worst:?}");
}

// Behaviour: a half-float level is BC6H blocks of sixteen bytes: the format's decoder
// (`block_compression::decode`) gives a flat block back within a thousandth, a ramp within a few
// percent of its range, a negative value reads as zero, and a side that is not a multiple of four pads by its
// edge.
#[test]
fn half_float_levels_are_bc6h_blocks() {
    use half::f16;
    let level = |values: &[[f32; 4]], width: u32, height: u32| -> Vec<u8> {
        let bytes: Vec<u8> = values
            .iter()
            .flatten()
            .flat_map(|&v| f16::from_f32(v).to_le_bytes())
            .collect();
        encode_hdr(&bytes, width, height)
    };
    // The 16 texels of a 4 × 4 block as RGB, row-major.
    let decoded = |block: &[u8]| -> [f32; 48] {
        let mut floats = [0f32; 48];
        block_compression::decode::decode_block_bc6h_float(block, &mut floats, 12, false);
        floats
    };
    let flat = level(&[[0.5, 0.25, 1.0, 1.0]; 16], 4, 4);
    assert_eq!(flat.len(), Layout::Hdr.block_bytes());
    for texel in decoded(&flat).chunks(3) {
        assert!(
            (texel[0] - 0.5).abs() < 1e-3
                && (texel[1] - 0.25).abs() < 1e-3
                && (texel[2] - 1.0).abs() < 1e-3,
            "{texel:?}"
        );
    }
    // Three channels of magnitudes 0..8, 1 and 85..100 share one index a texel and endpoints
    // interpolated in the half-float bit pattern, which the red channel's span (zero to 7.5) rules: the
    // encoder, the format's usual quality (`BC6HSettings::basic`), lands the red within a
    // seventh of its range and the blue within a quarter of its value, 17 % at worst.
    let ramp: Vec<[f32; 4]> = (0..16)
        .map(|i| [i as f32 * 0.5, 1.0, 100.0 - i as f32, 1.0])
        .collect();
    for (i, texel) in decoded(&level(&ramp, 4, 4)).chunks(3).enumerate() {
        assert!(
            (texel[0] - i as f32 * 0.5).abs() < 1.0
                && (texel[1] - 1.0).abs() < 0.3
                && (texel[2] / (100.0 - i as f32) - 1.0).abs() < 0.25,
            "{i}: {texel:?}"
        );
    }
    let negative = level(&[[-3.0, 0.0, 0.0, 1.0]; 16], 4, 4);
    assert!(decoded(&negative).chunks(3).all(|t| t[0] == 0.0));
    let odd = level(&[[0.5; 4]; 5 * 3], 5, 3);
    assert_eq!(odd.len(), 2 * Layout::Hdr.block_bytes());
    // The bytes of the flat block are the vector the page's decoder reads back
    // (`blockDecodeMore.test.ts`).
    assert_eq!(
        flat,
        [175, 243, 173, 191, 7, 7, 44, 240, 18, 17, 17, 17, 17, 17, 17, 17]
    );
}
