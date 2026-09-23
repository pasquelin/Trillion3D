//! The other half of the golden: what the driver refuses, and under which name it reports it. A
//! DDS outside the list does not panic and interrupts no compilation — it lets the engine fall
//! back on its white, and the manifest counts the reason. Each refusal is checked by its reason
//! code.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, MAX_ALLOC, ORDER, SIDE};

/// Absolute offsets of the fields these cases later modify, magic number included.
const DEPTH: usize = 24;
const CAPS2: usize = 112;
const ARRAY_SIZE: usize = 140;
const MISC_FLAGS_2: usize = 144;

fn patched(mut file: Vec<u8>, at: usize, value: u32) -> Vec<u8> {
    file[at..at + 4].copy_from_slice(&value.to_le_bytes());
    file
}

fn dxt1(payload: &[u8], levels: u32) -> Vec<u8> {
    bytes::container(bytes::fourcc_format(b"DXT1"), SIDE, SIDE, levels, payload)
}

// Driver contract: the format is recognised by the extension as by the magic number, and
// everything that is not declared comes out as a named report reason, never as a panic.
#[test]
fn a_dds_outside_the_list_or_truncated_comes_out_as_a_report_reason_never_as_a_panic() {
    for extension in ["dds", "DDS"] {
        let path = std::path::PathBuf::from(format!("albedo.{extension}"));
        let decoder = registry::by_extension(&path).expect("claimed");
        assert_eq!(decoder.name(), "dds", "{extension}");
        assert_eq!(decoder.mime(), "image/vnd.ms-dds");
    }
    // Thirty-one bytes of forty-three thousand: the magic number is there, the header is not.
    let truncated = fixture("dds", "tronque.dds");
    assert_eq!(registry::by_head(&truncated).map(|d| d.name()), Some("dds"));
    assert_eq!(
        registry::decode(&truncated, MAX_ALLOC).err(),
        Some("dds-header-truncated")
    );
    // A DX10 header announced but absent is the same cut, seen twenty bytes further.
    let block = bytes::color_block(ORDER);
    let dx10 = bytes::container(bytes::fourcc_format(b"DX10"), SIDE, SIDE, 1, &[]);
    assert_eq!(
        registry::decode(&dx10, MAX_ALLOC).err(),
        Some("dds-header-truncated")
    );
    // Codecs outside the list: float BC6H, signed variants, premultiplied alpha, 16-bit,
    // unexpected masks, and a `DDS_PIXELFORMAT` that names neither `dwFourCC` nor RGB channels.
    for (case, file) in [
        ("bc6h", bytes::dx10(95, SIDE, SIDE, &[0; 16])),
        ("signed bc4", bytes::dx10(81, SIDE, SIDE, &[0; 8])),
        ("typeless bc1", bytes::dx10(70, SIDE, SIDE, &block)),
        (
            "premultiplied bc3",
            patched(bytes::dx10(77, SIDE, SIDE, &[0; 16]), MISC_FLAGS_2, 2),
        ),
        (
            "premultiplied dxt2",
            bytes::container(bytes::fourcc_format(b"DXT2"), SIDE, SIDE, 1, &block),
        ),
        (
            "565 on sixteen bits",
            bytes::container(
                bytes::mask_format(16, [0xf800, 0x07e0, 0x001f, 0]),
                SIDE,
                SIDE,
                1,
                &[0; 32],
            ),
        ),
        (
            "shifted masks",
            bytes::container(
                bytes::mask_format(32, [0xff, 0xff00, 0xff_0000, 0x0f00_0000]),
                SIDE,
                SIDE,
                1,
                &[0; 64],
            ),
        ),
        (
            "neither fourcc nor rgb",
            bytes::container(
                [
                    0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    0, 0, 0, 0, 0, 0, 0,
                ],
                SIDE,
                SIDE,
                1,
                &block,
            ),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-codec-unsupported"),
            "{case}"
        );
    }
    // Layouts outside the list: cube, volume, texture array.
    for (case, file) in [
        ("cube", patched(dxt1(&block, 1), CAPS2, 0x200)),
        ("volume", patched(dxt1(&block, 1), DEPTH, 4)),
        (
            "array",
            patched(bytes::dx10(71, SIDE, SIDE, &block), ARRAY_SIZE, 6),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-layout-unsupported"),
            "{case}"
        );
    }
    // Header outside domain: announced size wrong, zero dimension, absurd levels.
    for (case, file) in [
        ("header size", patched(dxt1(&block, 1), 4, 120)),
        ("zero width", patched(dxt1(&block, 1), 16, 0)),
        ("absurd levels", dxt1(&block, 4_000)),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-header-invalid"),
            "{case}"
        );
    }
    // The announced chain must fit: nine levels promised, a single block written.
    assert_eq!(
        registry::decode(&dxt1(&block, 9), MAX_ALLOC).err(),
        Some("dds-data-truncated")
    );
    // The allocation ceiling is a refusal, never an allocation attempted: 4 × 4 pixels make
    // sixty-four bytes of RGBA8, one more than this ceiling.
    assert_eq!(
        registry::decode(&dxt1(&block, 1), 63).err(),
        Some("dds-image-too-large")
    );
}

// Driver contract on a real file, written by a third-party encoder: the header is read, only
// level 0 comes out, and the announced mip chain is counted — one byte less and the file is no
// longer readable.
#[test]
fn the_nine_level_bc1_yields_its_level_zero_and_counts_its_chain() {
    let file = fixture("dds", "bc1-mips.dds");
    assert_eq!(registry::by_head(&file).map(|d| d.name()), Some("dds"));
    let image = super::super::rgba8(registry::decode(&file, MAX_ALLOC).expect("decoded"));
    assert_eq!((image.width(), image.height()), (256, 256));
    // The corpus encoder writes constant blocks: each 4 × 4 square comes out of a single
    // colour. A level mixed with another, or a one-line shift, would show here.
    for block in 0..(64 * 64) {
        let (left, top) = (block % 64 * 4, block / 64 * 4);
        let first = image.get_pixel(left, top).0;
        for pixel in 0..16u32 {
            let seen = image.get_pixel(left + pixel % 4, top + pixel / 4).0;
            assert_eq!(seen, first, "block ({left}, {top})");
        }
    }
    assert_eq!(
        registry::decode(&file[..file.len() - 1], MAX_ALLOC).err(),
        Some("dds-data-truncated"),
        "nine levels announced, one byte missing"
    );
}
