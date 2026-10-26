use super::*;

// Level alpha is the MEAN of the four texels, like the colours: no median, no weighing of a
// texel by another, no coverage kept across levels.
#[test]
fn alpha_is_the_mean_of_four_texels() {
    let cases: [([u8; 4], u8); 4] = [
        ([0, 0, 0, 255], 64),      // single present: a quarter
        ([0, 255, 255, 255], 191), // three present: three quarters
        ([0, 0, 255, 255], 128),   // two of four: halfway
        ([10, 200, 60, 90], 90),   // arbitrary: (10 + 200 + 60 + 90) / 4
    ];
    for (alphas, expected) in cases {
        let source = rgba_from(2, 2, |x, y| [50, 50, 50, alphas[(y * 2 + x) as usize]]);
        for kind in [AtlasKind::Color, AtlasKind::Data] {
            let chain = crate::texture::reduce::chain(&source, &[], kind);
            assert_eq!(chain.len(), 2, "2×2 then 1×1");
            assert_eq!(chain[1][3], expected, "alphas {alphas:?}");
        }
    }
}

// Behaviour: odd side repeats last texel instead of dropping it —
// `min(p + 1, hi)` in shader —, so single column counts double.
#[test]
fn an_odd_side_repeats_its_last_texel() {
    let source = rgba_from(3, 1, |x, _| [0, 0, 0, [0, 0, 255][x as usize]]);
    let chain = crate::texture::reduce::chain(&source, &[], AtlasKind::Data);
    // 3x1 -> 1x1: cell covers cols 0 and 1 only, alphas 0 and 0 (repeated in y).
    assert_eq!(
        chain[1],
        vec![0, 0, 0, 0],
        "the third column does not enter cell 0"
    );
    let wide = rgba_from(5, 1, |x, _| [0, 0, 0, [0, 0, 0, 0, 255][x as usize]]);
    let chain = crate::texture::reduce::chain(&wide, &[], AtlasKind::Data);
    // 5x1 -> 2x1: cell 1 covers cols 2 and 3; -> 1x1: cells 0 and 1.
    assert_eq!(chain[1].len(), 8);
    assert_eq!(chain[2].len(), 4);
    assert_eq!(chain[2][3], 0);
}
