use super::*;

// Comportement 4 : l'alpha d'un niveau est la MÉDIANE de ses quatre texels, la moyenne des deux du
// milieu — exactement `(u + v) / 2` du nuanceur de `textureMips.ts` — et jamais leur moyenne. Un
// texel grossier passe un seuil quand deux des quatre le passaient : la couverture d'une découpe
// se conserve d'un niveau au suivant, quel que soit le seuil, ce que la moyenne ne fait pas.
#[test]
fn alpha_is_the_median_of_four_texels_not_their_mean() {
    // Quatre motifs 2×2, chacun réduit en un texel ; la moyenne trancherait autrement dans trois
    // cas sur quatre.
    let cases: [([u8; 4], u8); 4] = [
        ([0, 0, 0, 255], 0),       // un seul présent : absent (la moyenne dirait 64)
        ([0, 255, 255, 255], 255), // trois présents : présent (la moyenne dirait 191)
        ([0, 0, 255, 255], 128),   // deux sur quatre : à mi-course, comme la moyenne
        ([10, 200, 60, 90], 75),   // quelconque : (60 + 90) / 2, la moyenne dirait 90
    ];
    for (alphas, expected) in cases {
        let source = rgba_from(2, 2, |x, y| [50, 50, 50, alphas[(y * 2 + x) as usize]]);
        let chain = reduce::chain(&source, AtlasKind::Color);
        assert_eq!(chain.len(), 2, "2×2 puis 1×1");
        assert_eq!(chain[1][3], expected, "alphas {alphas:?}");
    }
}

// Comportement 4 (b) : un côté impair répète son dernier texel au lieu de le laisser de côté —
// `min(p + 1, hi)` dans le nuanceur —, si bien qu'une colonne seule compte double.
#[test]
fn an_odd_side_repeats_its_last_texel() {
    let source = rgba_from(3, 1, |x, _| [0, 0, 0, [0, 0, 255][x as usize]]);
    let chain = reduce::chain(&source, AtlasKind::Data);
    // 3×1 → 1×1 : la case couvre les colonnes 0 et 1 seulement, alphas 0 et 0 (répété en y).
    assert_eq!(
        chain[1],
        vec![0, 0, 0, 0],
        "la troisième colonne n'entre pas dans la case 0"
    );
    let wide = rgba_from(5, 1, |x, _| [0, 0, 0, [0, 0, 0, 0, 255][x as usize]]);
    let chain = reduce::chain(&wide, AtlasKind::Data);
    // 5×1 → 2×1 : la case 1 couvre les colonnes 2 et 3 ; → 1×1 : les cases 0 et 1.
    assert_eq!(chain[1].len(), 8);
    assert_eq!(chain[2].len(), 4);
    assert_eq!(chain[2][3], 0);
}
