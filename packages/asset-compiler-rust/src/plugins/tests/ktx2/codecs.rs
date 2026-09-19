//! What `vkFormat` decides: which decoder reads the level, and on which block geometry. The
//! Vulkan registry fixes both, and the missing byte proves it format by format — a block one
//! byte shorter no longer covers the announced surface, so the level is refused.
//!
//! The other half is Zstandard supercompression: the length the index announces bounds both
//! allocation and reading, and a stream that does not yield that length is a refusal, never a
//! half-full buffer.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, ASTC_4X4, BC1_RGBA, MAX_ALLOC, SIDE};

/// Declared compressed `vkFormat` and the bytes of their 4 × 4 texel block, in Vulkan registry
/// order: BC1 without then with alpha, BC2, BC3, BC4, BC5, BC7, the three ETC2, the two EAC and
/// ASTC 4 × 4, each with its `_SRGB` variant when the registry publishes one.
const BLOCKS: [(u32, usize); 22] = [
    (131, 8),
    (132, 8),
    (133, 8),
    (134, 8),
    (135, 16),
    (136, 16),
    (137, 16),
    (138, 16),
    (139, 8),
    (141, 16),
    (145, 16),
    (146, 16),
    (147, 8),
    (148, 8),
    (149, 8),
    (150, 8),
    (151, 16),
    (152, 16),
    (153, 8),
    (155, 16),
    (157, 16),
    (158, 16),
];

// Driver contract on the declared codecs: each compressed `vkFormat` leads to the decoder whose
// block geometry is that of the Vulkan registry, and nothing that is declared panics.
#[test]
fn each_declared_compressed_vkformat_carries_the_registry_block_geometry() {
    for (format, block) in BLOCKS {
        let full = bytes::container(format, SIDE, SIDE, &vec![0u8; block]);
        let image = super::super::rgba8(
            registry::decode(&full, MAX_ALLOC)
                .unwrap_or_else(|reason| panic!("format {format}: {reason}")),
        );
        assert_eq!((image.width(), image.height()), (SIDE, SIDE), "{format}");
        let short = bytes::container(format, SIDE, SIDE, &vec![0u8; block - 1]);
        assert_eq!(
            registry::decode(&short, MAX_ALLOC).err(),
            Some("ktx2-data-truncated"),
            "format {format}: a block of {block} bytes, not of {}",
            block - 1
        );
    }
    // The two compressed formats whose texels the golden writes in the open are indeed in the list.
    for format in [BC1_RGBA, ASTC_4X4] {
        assert!(BLOCKS.iter().any(|(declared, _)| *declared == format));
    }
}

// Driver contract on Zstandard supercompression: the announced length bounds reading and
// allocation, and what does not come out of it exactly is a named refusal.
#[test]
fn zstandard_supercompression_is_bounded_by_the_announced_length() {
    let file = fixture("ktx2", "base-zstd.ktx2");
    for (case, patched, ceiling, reason) in [
        (
            "announcement too short for the surface",
            bytes::patched64(file.clone(), bytes::HEADER_END + 16, 32),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
        (
            "announcement beyond the ceiling",
            bytes::patched64(file.clone(), bytes::HEADER_END + 16, 1000),
            64,
            "ktx2-image-too-large",
        ),
        (
            "cut frame",
            bytes::patched64(file.clone(), bytes::HEADER_END + 8, 20),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
        (
            "frame that is not one",
            bytes::patched(file.clone(), ZSTD_DATA, 0),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
    ] {
        assert_eq!(
            registry::decode(&patched, ceiling).err(),
            Some(reason),
            "{case}"
        );
    }
}

/// Level 0 of `base-zstd.ktx2` starts after the header, a one-level index and a
/// ninety-two-byte format descriptor.
const ZSTD_DATA: usize = 196;

/// `VK_FORMAT_EAC_R11_UNORM_BLOCK` and `VK_FORMAT_EAC_R11G11_UNORM_BLOCK`.
const EAC_R11: u32 = 153;
const EAC_RG11: u32 = 155;
/// Table 13 of the specification, `{-1, -2, -3, -10, 0, 1, 2, 9}`: its first three positive
/// modifiers are 0, 1 and 2, the smallest steps the format can write, so exactly those a
/// three-bit truncation erases.
const TABLE_13: u8 = 13;

// Reproduction of finding 55: an EAC channel carries eleven bits, the contract eight. The
// external decoder used to bring them down by `val >> 3`, a truncation that lowers one value
// in eight by one step, and read the index field backwards, which mixed the sixteen texels of
// a block. The driver now expands these two formats itself, in eleven bits, then rounds to
// nearest.
//
// The block written here has base word 0 and multiplier 0 — which the specification reads as
// one — so its values are `4 + modifier`. Texel 0 takes index 5 (modifier 1, value 5), texel
// 15 index 7 (modifier 9, value 13), the other fourteen index 4 (modifier 0, value 4). A
// truncation would yield 0, 1 and 0; rounding yields 1, 2 and 0.
#[test]
fn the_eleven_bits_of_an_eac_channel_are_rounded_and_texels_stay_in_place() {
    let mut indices = [4u8; 16];
    indices[0] = 5;
    indices[15] = 7;
    let rouge = bytes::eac(0, 0, TABLE_13, indices);
    let attendu: Vec<u8> = (0..16)
        .map(|texel| match texel {
            0 => 1,
            15 => 2,
            _ => 0,
        })
        .collect();
    let file = bytes::container(EAC_R11, SIDE, SIDE, &rouge);
    let image = super::super::rgba8(
        registry::decode(&file, MAX_ALLOC).unwrap_or_else(|reason| panic!("eac r11: {reason}")),
    );
    let canal = |at: usize| -> Vec<u8> { image.pixels().map(|pixel| pixel.0[at]).collect() };
    assert_eq!(canal(0), attendu, "red of an EAC R11");
    assert_eq!(canal(1), vec![0; 16], "green of an EAC R11 stays zero");
    assert_eq!(canal(3), vec![255; 16], "alpha of an EAC is opaque");
    // The second channel of an RG11 is one more block, read the same way and yielded as green.
    let mut deux = rouge.clone();
    deux.extend_from_slice(&bytes::eac(0, 0, TABLE_13, indices));
    let paire = bytes::container(EAC_RG11, SIDE, SIDE, &deux);
    let image = super::super::rgba8(
        registry::decode(&paire, MAX_ALLOC).unwrap_or_else(|reason| panic!("eac rg11: {reason}")),
    );
    let canal = |at: usize| -> Vec<u8> { image.pixels().map(|pixel| pixel.0[at]).collect() };
    assert_eq!(canal(0), attendu, "red of an EAC RG11");
    assert_eq!(canal(1), attendu, "green of an EAC RG11");
}
