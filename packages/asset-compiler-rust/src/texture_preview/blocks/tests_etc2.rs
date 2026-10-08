//! The ETC2 family — ETC2 RGBA8 and EAC RG11 — proved on the same independent
//! decoder as the others (`texture2ddecoder`): what it reads back is what a
//! card shows, the writer's own idea of its error never enters.
use super::tests::{constant, decode, photo, psnr};
use super::tests_two_channel::normals;
use super::*;

fn two_channels(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let level = encode_level(rgba, width, height, BlockFormat::Etc2, Layout::TwoChannel);
    assert_eq!(level.len(), level_block_bytes(width, height));
    decode::decode_level(&level, width, height, BlockFormat::Etc2, Layout::TwoChannel)
        .expect("decodable")
}

fn rgba(source: &[u8], width: u32, height: u32) -> Vec<u8> {
    let level = encode_level(source, width, height, BlockFormat::Etc2, Layout::Rgba);
    assert_eq!(level.len(), level_block_bytes(width, height));
    decode(&level, width, height, BlockFormat::Etc2)
}

// Behaviour: the engine pins one white block per family (`WHITE_TAIL`,
// `packages/sdk-browser/src/texture/blockFormats.ts`); the ETC2 one — an EAC
// alpha at 255, an individual-mode colour at 15 on every channel — reads back
// opaque white.
#[test]
fn the_etc2_white_block_the_engine_pins_decodes_to_opaque_white() {
    let white = [
        0xFF, 0x1D, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0, 0, 0, 0,
    ];
    assert_eq!(decode(&white, 4, 4, BlockFormat::Etc2), constant([255; 4]));
}

// Behaviour: one channel held flat decodes to its exact byte, every byte, in
// both layouts — the EAC alpha of an RGBA block and each half of RG11 — and a
// flat colour the planar corners hold comes back exact too.
#[test]
fn flat_channels_decode_exactly_in_both_layouts() {
    for byte in 0..=255u8 {
        assert_eq!(rgba(&constant([162, 201, 40, byte]), 4, 4)[3], byte);
        let xy = two_channels(&constant([byte, 255 - byte, 0, 0]), 4, 4);
        assert_eq!((xy[0], xy[1]), (byte, 255 - byte), "byte {byte}");
    }
    assert_eq!(
        rgba(&constant([162, 201, 40, 77]), 4, 4),
        constant([162, 201, 40, 77])
    );
}

// Behaviour: a gradient across the block takes the planar mode, whose bits the
// decoder must recognise to read it back within two levels: the half-block
// modes would band it by tens.
#[test]
fn a_gradient_reads_back_through_the_planar_mode() {
    let ramp: Vec<u8> = (0..16u8)
        .flat_map(|i| [(i % 4) * 60, (i / 4) * 60, 128, 255])
        .collect();
    let back = rgba(&ramp, 4, 4);
    let worst = ramp.iter().zip(&back).map(|(a, b)| a.abs_diff(*b)).max();
    assert!(worst <= Some(2), "largest gap {worst:?}");
}

// Behaviour: on a textured image the loss stays bounded, and a normal map's
// two channels read back above the gate and above one RGBA block; odd sizes pad
// by whole blocks.
#[test]
fn textured_and_normal_levels_decode_within_the_declared_loss() {
    for (width, height) in [(64u32, 48u32), (13, 7), (1, 1), (2, 130)] {
        let source = photo(width, height);
        let db = psnr(&rgba(&source, width, height), &source);
        assert!(db >= 38.0, "{width}×{height}: {db:.1} dB");
        let source = normals(width, height);
        let xyz = |level: &[u8]| -> Vec<u8> {
            level.chunks(4).flat_map(|t| [t[0], t[1], t[2]]).collect()
        };
        let two = psnr(&xyz(&two_channels(&source, width, height)), &xyz(&source));
        assert!(
            two >= quality::GATE_DB,
            "{width}×{height}: two channels {two:.1} dB"
        );
    }
    let source = normals(64, 64);
    let (one, two) = (
        psnr(&rgba(&source, 64, 64), &source),
        psnr(&two_channels(&source, 64, 64), &source),
    );
    assert!(two > one, "RGBA {one:.1} dB, two channels {two:.1} dB");
}
