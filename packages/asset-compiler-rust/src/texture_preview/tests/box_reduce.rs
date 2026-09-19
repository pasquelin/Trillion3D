use super::*;

// Behavior 3 (a): image with no side exceeding base carried as is. Level
// 0 is source byte for byte, engine loads nothing else for it.
#[test]
fn a_source_under_the_base_carries_its_own_full_resolution() {
    let (width, height) = (4u32, 4u32);
    let source = rgba_from(width, height, |x, y| {
        [(x * 60) as u8, (y * 60) as u8, 10, 255]
    });
    let (first, pixels) = tail_of(&source, AtlasKind::Color);
    assert_eq!(first, 0);
    assert_eq!(level_size(width, height, 0), (4, 4));
    assert_eq!(
        level_bytes(width, height, &pixels, 0),
        source.as_raw().as_slice(),
        "le niveau 0 est la source sans perte"
    );
}

// Behavior 3 (b): odd unequal dimensions (17x9) do not crash
// reduction, uniform color survives exactly at each level — sRGB curve
// round-trips all 256 bytes —, written length matches geometry.
#[test]
fn odd_dimensions_reduce_without_panicking() {
    let (width, height) = (17u32, 9u32);
    let source = rgba_from(width, height, |_x, _y| [37, 201, 88, 255]);
    let (first, pixels) = tail_of(&source, AtlasKind::Color);
    assert_eq!(first, 0);
    assert_eq!(pixels.len(), preview_pixel_bytes(width, height));
    assert_eq!(preview_level_count(width, height), 5);
    for index in 0..preview_level_count(width, height) as usize {
        for texel in level_bytes(width, height, &pixels, index).chunks(4) {
            assert_eq!(texel, [37, 201, 88, 255], "niveau {index} uniforme");
        }
    }
}

// Behavior 3 (c): sRGB curve does exact round-trip on all 256 byte values —
// otherwise uniform level would drift a step each reduction.
#[test]
fn the_srgb_curve_round_trips_every_byte() {
    for value in 0..=255u8 {
        let source = rgba_from(2, 2, |_, _| [value, value, value, 255]);
        let chain = reduce::chain(&source, AtlasKind::Color);
        assert_eq!(&chain[1][..3], &[value, value, value], "octet {value}");
    }
}
