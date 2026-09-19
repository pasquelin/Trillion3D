use super::*;

/// Independent sRGB byte → linear decode, used only to *verify* the pyramid's output; the
/// production table lives in `reduce::srgb_table` and is never called from a test.
fn linear(byte: u8) -> f32 {
    let c = byte as f32 / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

// Behavior 2: level after first is exact 2x2 average of previous,
// linear premultiplied — alpha 255 everywhere, premultiplied == linear directly.
#[test]
fn each_level_is_the_exact_2x2_average_of_the_previous_one() {
    let (width, height) = (32u32, 32u32);
    let source = rgba_from(width, height, |x, y| {
        [
            ((x * 7 + y * 3) % 256) as u8,
            ((x * 13 + 5) % 256) as u8,
            ((y * 19 + 11) % 256) as u8,
            255,
        ]
    });
    let (first, pixels) = tail_of(&source, AtlasKind::Color);
    assert_eq!(first, 0, "a 32 px source already fits under the base");
    let count = preview_level_count(width, height) as usize;
    for index in 0..count - 1 {
        let (fine_side, _) = level_size(width, height, index);
        let (coarse_side, coarse_rows) = level_size(width, height, index + 1);
        let side = fine_side as usize;
        let next_side = coarse_side as usize;
        let fine = level_bytes(width, height, &pixels, index);
        let coarse = level_bytes(width, height, &pixels, index + 1);
        for row in 0..coarse_rows as usize {
            for column in 0..next_side {
                for channel in 0..3usize {
                    let mut sum = 0f32;
                    for dy in 0..2 {
                        for dx in 0..2 {
                            let at = ((row * 2 + dy) * side + column * 2 + dx) * 4 + channel;
                            sum += linear(fine[at]);
                        }
                    }
                    let expected = sum * 0.25;
                    let actual = linear(coarse[(row * next_side + column) * 4 + channel]);
                    assert!(
                        (expected - actual).abs() <= 0.02,
                        "level {fine_side} to {coarse_side}, texel ({row},{column}) channel {channel}: expected {expected}, got {actual}"
                    );
                }
            }
        }
    }
}

// Behavior 1: level count, sizes, bytes for non-square texture with both
// sides exceeding base, and for texture large enough to saturate seven levels and
// maximum 21,844 bytes documented by module.
#[test]
fn geometry_matches_expectations_for_a_non_square_and_a_maximal_texture() {
    // 128x64: exactly double base per side, one level under max.
    assert_eq!(preview_first_level(128, 64), 1);
    assert_eq!(preview_last_level(128, 64), 7);
    assert_eq!(preview_level_count(128, 64), 7);
    assert_eq!(preview_level_size(128, 64, 1), (64, 32));
    assert_eq!(preview_level_size(128, 64, 7), (1, 1));
    assert_eq!(preview_pixel_bytes(128, 64), 10_924);

    // 4096x4096: large enough for first carried level to land exactly on base.
    assert_eq!(preview_first_level(4096, 4096), 6);
    assert_eq!(preview_last_level(4096, 4096), 12);
    assert_eq!(preview_level_count(4096, 4096), PREVIEW_MAX_LEVELS);
    assert_eq!(
        preview_level_size(4096, 4096, 6),
        (PREVIEW_BASE, PREVIEW_BASE)
    );
    assert_eq!(preview_pixel_bytes(4096, 4096), 21_844);
}
