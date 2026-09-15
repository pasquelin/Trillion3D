use super::*;

// Comportement 4 (a) : la couverture MASK à pleine résolution se retrouve, à un texel près, à
// chacun des cinq niveaux — la recherche d'échelle d'alpha préserve la fraction de texels visibles.
#[test]
fn mask_coverage_is_preserved_within_one_texel_at_every_level() {
    let cutoff = 0.5f32;
    // Un dégradé le long d'un seul axe, comme le bord anti-aliasé d'un vrai sprite MASK : chaque
    // colonne porte une valeur d'alpha distincte des autres, si bien que franchir le seuil ne fait
    // jamais basculer plusieurs texels d'un coup (contrairement à un motif à symétrie radiale, où
    // tout un anneau de texels équidistants partage la même valeur et peut basculer ensemble).
    const SIDE: u32 = 256;
    let alpha_at = |x: u32, _y: u32| ((x * 255) / (SIDE - 1)) as u8;
    let covered_at = |x: u32, y: u32| alpha_at(x, y) as f32 / 255.0 >= cutoff;
    let source = rgba_from(SIDE, SIDE, |x, y| [200, 40, 40, alpha_at(x, y)]);
    let covered_source = (0..SIDE)
        .flat_map(|y| (0..SIDE).map(move |x| (x, y)))
        .filter(|&(x, y)| covered_at(x, y))
        .count();
    let target = covered_source as f32 / (SIDE * SIDE) as f32;
    let pixels = reduce::pyramid(&source, Some(cutoff));
    for (level, &side) in PREVIEW_LEVEL_SIZES.iter().enumerate() {
        let side = side as usize;
        let bytes = level_bytes(&pixels, level);
        let covered = bytes.chunks(4).filter(|texel| texel[3] >= 128).count() as i64;
        let expected = (target * (side * side) as f32).round() as i64;
        assert!(
            (covered - expected).abs() <= 1,
            "niveau {side}×{side} : couverture {covered}, attendue {expected} (±1 texel)"
        );
    }
}

// Comportement 4 (b) : sans seuil de découpe (liaison qui n'est pas la couleur de base d'un
// matériau MASK), l'alpha ressort inchangé — simple moyenne de boîte, jamais remis à l'échelle.
#[test]
fn alpha_is_unchanged_without_a_mask_cutoff() {
    let source = rgba_from(32, 32, |x, _y| [10, 20, 30, (x * 8) as u8]);
    let pixels = reduce::pyramid(&source, None);
    let level0 = level_bytes(&pixels, 0);
    for column in 0..16usize {
        let (a0, a1) = ((2 * column * 8) as i32, ((2 * column + 1) * 8) as i32);
        let expected = ((a0 + a1) as f32 / 2.0).round() as i32;
        let actual = level0[column * 4 + 3] as i32;
        assert!(
            (expected - actual).abs() <= 1,
            "colonne {column} : alpha attendu {expected}, obtenu {actual}"
        );
    }
}
