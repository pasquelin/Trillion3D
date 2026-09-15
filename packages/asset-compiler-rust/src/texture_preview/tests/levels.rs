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

// Comportement 2 : chaque niveau après le premier est la moyenne 2×2 exacte du précédent, en
// linéaire prémultiplié — ici alpha vaut 255 partout, donc prémultiplié == linéaire directement.
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
    let (first, pixels) = reduce::pyramid(&source, None);
    assert_eq!(first, 0, "une source de 32 px tient déjà sous la base");
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
                        "niveau {fine_side} vers {coarse_side}, texel ({row},{column}) canal {channel} : attendu {expected}, obtenu {actual}"
                    );
                }
            }
        }
    }
}
