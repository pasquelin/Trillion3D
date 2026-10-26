use super::*;

// Behaviour 1: the curve is the ATLAS's, not the file's. The three colour
// channels of a colour atlas (`rgba8unorm-srgb`) are averaged in linear then
// re-encoded; those of a data atlas (`rgba8unorm`) are averaged as-is. The same
// byte therefore yields two different levels depending on which atlas will read
// it — and that is what the map already did.
#[test]
fn the_same_bytes_reduce_differently_for_each_atlas() {
    // A black-and-white checker: the linear average of a 0 and a 255 sRGB is 0.5
    // in light, i.e. 188 once re-encoded; in data, it is 128 plain.
    let source = rgba_from(2, 2, |x, y| {
        let v = if (x + y) % 2 == 0 { 255 } else { 0 };
        [v, v, v, 255]
    });
    let color = crate::texture::reduce::chain(&source, &[], AtlasKind::Color);
    let data = crate::texture::reduce::chain(&source, &[], AtlasKind::Data);
    assert_eq!(
        &color[1][..3],
        &[188, 188, 188],
        "average in light, re-encoded sRGB"
    );
    assert_eq!(&data[1][..3], &[128, 128, 128], "average of raw bytes");
    assert_eq!(color[1][3], 255);
    assert_eq!(data[1][3], 255);
}

// Behaviour 2: a transparent texel's colour enters the mean like any other, never weighed by its
// alpha.
#[test]
fn a_transparent_texel_color_enters_the_data_mean_unweighted() {
    let source = rgba_from(2, 1, |x, _| {
        if x == 0 {
            [255, 0, 0, 255]
        } else {
            [0, 255, 0, 0]
        }
    });
    let chain = crate::texture::reduce::chain(&source, &[], AtlasKind::Data);
    assert_eq!(chain[1], vec![128, 128, 0, 128]);
}

// Behavior 3: next level computed from BYTES of previous, never from
// float kept aside — what GPU reads; two chains starting from same level `k` bytes
// give same level `k + 1`, regardless of path to `k`.
#[test]
fn each_level_is_derived_from_the_quantized_previous_level() {
    let source = rgba_from(8, 8, |x, y| [((x * 37 + y * 11) % 256) as u8, 7, 200, 255]);
    let chain = crate::texture::reduce::chain(&source, &[], AtlasKind::Color);
    let level1 = image::RgbaImage::from_raw(4, 4, chain[1].to_vec()).expect("level 1");
    let from_level1 = crate::texture::reduce::chain(&level1, &[], AtlasKind::Color);
    assert_eq!(chain[2..], from_level1[1..]);
}

// Behaviour: a source stored at 16 bits a channel is reduced in float from its samples, each level
// rounded to bytes once: three quadrants at 100.49 of 255 and one at 100.9 mean 100.59 — byte 101 —
// where a chain reduced from rounded levels (100, 100, 100, 101) means 100.25 and lands on 100.
#[test]
fn a_sixteen_bit_source_reduces_from_its_samples_not_from_rounded_levels() {
    let quadrant = |x: u32, y: u32| if x >= 2 && y >= 2 { 25931u16 } else { 25827 };
    let wide: Vec<u16> = (0..16)
        .flat_map(|at| {
            let v = quadrant(at % 4, at / 4);
            [v, v, v, u16::MAX]
        })
        .collect();
    let bytes = wide
        .iter()
        .map(|&v| ((u32::from(v) + 128) / 257) as u8)
        .collect();
    let source = image::RgbaImage::from_raw(4, 4, bytes).unwrap();
    for kind in [AtlasKind::Data, AtlasKind::Color] {
        let from_wide = crate::texture::reduce::chain_wide(&source, &wide, kind);
        let from_bytes = crate::texture::reduce::chain(&source, &[], kind);
        assert_eq!(from_wide.len(), 3);
        assert_eq!(from_wide[0], from_bytes[0], "level 0 is the rounded source");
        assert_eq!(
            from_wide[1], from_bytes[1],
            "a quadrant alone rounds the same"
        );
        assert_eq!(from_wide[2][3], 255, "alpha is a mean like the colours");
        if kind == AtlasKind::Data {
            assert_eq!(from_bytes[2][0], 100);
            assert_eq!(from_wide[2][0], 101);
        } else {
            assert_ne!(
                from_wide[2][0], from_bytes[2][0],
                "the colour chain differs too"
            );
        }
    }
}
