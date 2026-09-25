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
    let color = reduce::chain(&source, AtlasKind::Color);
    let data = reduce::chain(&source, AtlasKind::Data);
    assert_eq!(
        &color[1][..3],
        &[188, 188, 188],
        "average in light, re-encoded sRGB"
    );
    assert_eq!(&data[1][..3], &[128, 128, 128], "average of raw bytes");
    assert_eq!(color[1][3], 255);
    assert_eq!(data[1][3], 255);
}

// Behaviour 2: a transparent texel's colour still enters the mean wherever no
// reader takes alpha for coverage, as in the shader: the `Coverage` chain alone
// weighs its colours by alpha (`weighted_colour.rs`, #42).
#[test]
fn a_transparent_texel_color_enters_the_data_mean_as_on_the_card() {
    let source = rgba_from(2, 1, |x, _| {
        if x == 0 {
            [255, 0, 0, 255]
        } else {
            [0, 255, 0, 0]
        }
    });
    let chain = reduce::chain(&source, AtlasKind::Data);
    assert_eq!(chain[1], vec![128, 128, 0, 128]);
}

// Behavior 3: next level computed from BYTES of previous, never from
// float kept aside — what GPU reads; two chains starting from same level `k` bytes
// give same level `k + 1`, regardless of path to `k`.
#[test]
fn each_level_is_derived_from_the_quantized_previous_level() {
    let source = rgba_from(8, 8, |x, y| [((x * 37 + y * 11) % 256) as u8, 7, 200, 255]);
    let chain = reduce::chain(&source, AtlasKind::Color);
    let level1 = image::RgbaImage::from_raw(4, 4, chain[1].clone()).expect("level 1");
    let from_level1 = reduce::chain(&level1, AtlasKind::Color);
    assert_eq!(chain[2..], from_level1[1..]);
}
