//! Transfer function a DDS declares, which does not change a single byte of its blocks.
//!
//! The `DXGI_FORMAT` enumeration publishes each codec in two variants, `_UNORM` and `_UNORM_SRGB`.
//! They carry exactly the same bytes and do not mean the same thing: the first announces samples
//! proportional to light, the second bytes encoded by the sRGB curve. Mixing them up lightens or
//! darkens the whole texture at the consumer.
//!
//! A legacy DDS — codec named by its `dwFourCC`, or surface described by its masks — declares
//! nothing: Direct3D 9 had no sRGB format. Convention assigns it sRGB, and that is said here.
use super::super::super::image as registry;
use super::{bytes, MAX_ALLOC, SIDE};

/// `DXGI_FORMAT_BC1_UNORM` and `DXGI_FORMAT_BC1_UNORM_SRGB`, the two names of the same block.
const BC1_UNORM: u32 = 71;
const BC1_SRGB: u32 = 72;

/// Transfer declared by this container, and the bytes of its image.
fn declared(case: &str, file: &[u8]) -> (registry::Transfer, Vec<u8>) {
    let decoded =
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case} : {reason}"));
    let transfer = decoded.transfer;
    (transfer, super::super::rgba8(decoded).into_raw())
}

// Reproduction of finding 56, DDS half: the same payload declared `_UNORM` then `_SRGB`. The
// pixels are the same — the codec does not change — and the transfer function the driver yields
// changes with the declaration. The driver previously assigned sRGB in both cases, so a linear
// texture was reread as if it carried the sRGB curve.
#[test]
fn the_same_block_declared_unorm_then_srgb_yields_two_transfers() {
    let block = vec![0x1f, 0x00, 0x00, 0xf8, 0x1b, 0x1b, 0x1b, 0x1b];
    let (linear, pixels) = declared("bc1 unorm", &bytes::dx10(BC1_UNORM, SIDE, SIDE, &block));
    let (srgb, same) = declared("bc1 srgb", &bytes::dx10(BC1_SRGB, SIDE, SIDE, &block));
    assert_eq!(pixels, same, "the codec is the same, so are the bytes");
    assert_eq!(linear, registry::Transfer::Linear, "`_UNORM`");
    assert_eq!(srgb, registry::Transfer::Srgb, "`_UNORM_SRGB`");
}

// Driver contract: a legacy DDS declares no transfer, and convention assigns it sRGB.
// This is a named choice, not an omission: Direct3D 9 had no sRGB format, and a colour texture
// written at that time is encoded by that curve.
#[test]
fn a_legacy_dds_declares_nothing_and_keeps_the_conventional_srgb() {
    let block = vec![0x1f, 0x00, 0x00, 0xf8, 0x1b, 0x1b, 0x1b, 0x1b];
    let fourcc = bytes::container(bytes::fourcc_format(b"DXT1"), SIDE, SIDE, 1, &block);
    assert_eq!(declared("dxt1", &fourcc).0, registry::Transfer::Srgb);
    let masks = bytes::mask_format(32, [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000]);
    let surface = bytes::container(masks, 1, 1, 1, &[1, 2, 3, 4]);
    assert_eq!(declared("bgra8", &surface).0, registry::Transfer::Srgb);
}
