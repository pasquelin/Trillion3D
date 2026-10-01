use super::super::image as registry;
use super::{fixture, rgba8};
use std::path::Path;

#[test]
fn avif_decodes_source_channels_and_alpha_without_premultiplying() {
    let bytes = fixture("avif", "rgba.avif");
    let driver = registry::by_extension(Path::new("color.AVIF")).unwrap();
    assert_eq!(driver.name(), "avif");
    assert_eq!(driver.mime(), "image/avif");
    assert_eq!(driver.dimensions(&bytes).unwrap(), (2, 2));
    let decoded = registry::decode(&bytes, 16).unwrap();
    assert_eq!(decoded.transfer, registry::Transfer::Srgb);
    assert!(decoded.notes.is_empty());
    let pixels = rgba8(decoded);
    // Independent libavif decode, stored beside the public fixture. Its YUV conversion can
    // round one code value differently; alpha and dimensions remain exact.
    let expected: Vec<[u8; 4]> = serde_json::from_slice(&fixture("avif", "expected.json")).unwrap();
    for (actual, expected) in pixels.pixels().zip(expected) {
        for channel in 0..3 {
            assert!(actual[channel].abs_diff(expected[channel]) <= 1);
        }
        assert_eq!(actual[3], expected[3]);
    }
    assert_eq!(pixels.dimensions(), (2, 2));
    assert_eq!(registry::decode(&bytes, 15).err(), Some("image-too-large"));
}

#[test]
fn avif_refuses_truncation_animations_and_unhandled_transforms_by_name() {
    // A brand-like word outside ftyp must not make an unrelated BMFF file an AVIF image.
    assert!(registry::by_head(b"\0\0\0\x10ftypisom\0\0\0\0avif").is_none());
    let original = fixture("avif", "rgba.avif");
    for length in [16, original.len() / 2, original.len() - 1] {
        assert!(registry::decode(&original[..length], 1024).is_err());
    }
    let mut animated = original.clone();
    animated[8..12].copy_from_slice(b"avis");
    assert_eq!(
        registry::decode(&animated, 1024).err(),
        Some("image-animation-unsupported")
    );
    let mut transformed = original;
    transformed.extend_from_slice(&[0, 0, 0, 9, b'i', b'r', b'o', b't', 1]);
    assert_eq!(
        registry::decode(&transformed, 1024).err(),
        Some("image-transform-unsupported")
    );
}
#[test]
fn avif_transfer_requires_an_srgb_property_associated_with_the_primary_item() {
    let original = fixture("avif", "rgba.avif");
    let colr = original.windows(4).position(|b| b == b"colr").unwrap();
    let ipma = original.windows(4).position(|b| b == b"ipma").unwrap();
    let mut absent = original.clone();
    absent[colr..colr + 4].copy_from_slice(b"free");
    assert_eq!(
        registry::decode(&absent, 1024).err(),
        Some("image-transfer-unsupported")
    );
    // An unrelated top-level colour box cannot establish the primary image's transfer.
    absent.extend_from_slice(&[
        0, 0, 0, 19, b'c', b'o', b'l', b'r', b'n', b'c', b'l', b'x', 0, 1, 0, 13, 0, 6, 128,
    ]);
    assert_eq!(
        registry::decode(&absent, 1024).err(),
        Some("image-transfer-unsupported")
    );
    let mut unlinked = original.clone();
    // FullBox(4), entry_count(4), primary item_id(2), count(1), four one-byte associations.
    assert_eq!(&unlinked[ipma + 15..ipma + 19], &[1, 2, 131, 4]);
    unlinked[ipma + 18] = 0;
    assert_eq!(
        registry::decode(&unlinked, 1024).err(),
        Some("image-transfer-unsupported")
    );
    let mut unspecified = original;
    unspecified[colr + 11] = 2;
    assert_eq!(
        registry::decode(&unspecified, 1024).err(),
        Some("image-transfer-unsupported")
    );
}
#[test]
fn avif_refuses_unconverted_primaries_and_icc_profiles() {
    let original = fixture("avif", "rgba.avif");
    let colr = original.windows(4).position(|b| b == b"colr").unwrap();
    for primaries in [2, 9, 12] {
        let mut bytes = original.clone();
        bytes[colr + 9] = primaries;
        assert_eq!(
            registry::decode(&bytes, 1024).err(),
            Some("image-primaries-unsupported")
        );
    }
    let mut profile = original;
    profile[colr + 4..colr + 8].copy_from_slice(b"prof");
    assert_eq!(
        registry::decode(&profile, 1024).err(),
        Some("image-profile-unsupported")
    );
}
