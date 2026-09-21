//! The two-channel layouts — BC5 and the ASTC luminance-alpha block on two
//! weight planes — proved on the same independent decoder: X comes back in R,
//! Y in G, whichever the family, and Z as the shader rebuilds it.
use super::tests::{constant, psnr};
use super::*;

fn decoded(rgba: &[u8], width: u32, height: u32, format: BlockFormat) -> Vec<u8> {
    let level = encode_level(rgba, width, height, format, Layout::TwoChannel);
    assert_eq!(level.len(), level_block_bytes(width, height));
    decode::decode_level(&level, width, height, format, Layout::TwoChannel).expect("decodable")
}

/// A normal map whose X and Y vary in directions of their own: what one RGBA
/// segment cannot hold and two ladders can.
fn normals(width: u32, height: u32) -> Vec<u8> {
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
                constant([x, y, decode::rebuilt_z(x, y), 255]),
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
        (BlockFormat::Bc7, quality::GATE_DB),
        (BlockFormat::Astc, quality::GATE_DB - 2.5),
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
        let one = encode_level(&source, 64, 64, format, Layout::Rgba);
        let one = psnr(
            &decode::decode_level(&one, 64, 64, format, Layout::Rgba).expect("decodable"),
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
                let packed = ise::packed_quints([q0, q1, q2]);
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
    assert_eq!(decode::rebuilt_z(128, 128), 255);
    assert_eq!(decode::rebuilt_z(255, 128), 128);
    assert_eq!(decode::rebuilt_z(255, 255), 128);
    assert_eq!(decode::rebuilt_z(0, 0), 128);
    assert_eq!(decode::rebuilt_z(191, 128), 238);
}
