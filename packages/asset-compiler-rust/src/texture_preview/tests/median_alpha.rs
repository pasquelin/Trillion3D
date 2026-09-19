use super::*;

// Behavior 4: level alpha is MEDIAN of four texels, average of middle
// two — exactly `(u + v) / 2` of `textureMips.ts` shader — never mean.
// Coarse texel passes threshold when two of four passed: cutout coverage
// preserved across levels, regardless of threshold, which mean fails to do.
#[test]
fn alpha_is_the_median_of_four_texels_not_their_mean() {
    // Four 2x2 patterns, each reduced to one texel; mean would decide differently in three
    // cas sur quatre.
    let cases: [([u8; 4], u8); 4] = [
        ([0, 0, 0, 255], 0),       // single present: absent (mean would give 64)
        ([0, 255, 255, 255], 255), // three present: present (mean would give 191)
        ([0, 0, 255, 255], 128),   // two of four: halfway, like mean
        ([10, 200, 60, 90], 75),   // quelconque : (60 + 90) / 2, la moyenne dirait 90
    ];
    for (alphas, expected) in cases {
        let source = rgba_from(2, 2, |x, y| [50, 50, 50, alphas[(y * 2 + x) as usize]]);
        let chain = reduce::chain(&source, AtlasKind::Color);
        assert_eq!(chain.len(), 2, "2×2 puis 1×1");
        assert_eq!(chain[1][3], expected, "alphas {alphas:?}");
    }
}

// Behavior 4 (b): odd side repeats last texel instead of dropping it —
// `min(p + 1, hi)` in shader —, so single column counts double.
#[test]
fn an_odd_side_repeats_its_last_texel() {
    let source = rgba_from(3, 1, |x, _| [0, 0, 0, [0, 0, 255][x as usize]]);
    let chain = reduce::chain(&source, AtlasKind::Data);
    // 3x1 -> 1x1: cell covers cols 0 and 1 only, alphas 0 and 0 (repeated in y).
    assert_eq!(
        chain[1],
        vec![0, 0, 0, 0],
        "the third column does not enter cell 0"
    );
    let wide = rgba_from(5, 1, |x, _| [0, 0, 0, [0, 0, 0, 0, 255][x as usize]]);
    let chain = reduce::chain(&wide, AtlasKind::Data);
    // 5x1 -> 2x1: cell 1 covers cols 2 and 3; -> 1x1: cells 0 and 1.
    assert_eq!(chain[1].len(), 8);
    assert_eq!(chain[2].len(), 4);
    assert_eq!(chain[2][3], 0);
}
