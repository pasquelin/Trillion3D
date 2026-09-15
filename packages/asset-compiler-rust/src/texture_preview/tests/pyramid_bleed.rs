use super::*;

// Comportement 1 : la chaîne est linéaire prémultipliée de bout en bout, si bien qu'une texture
// semi-transparente à bord dur ne fait pas saigner sa couleur transparente ("poison") dans les
// texels opaques voisins qui partagent une même case de réduction.
#[test]
fn a_hard_edge_does_not_bleed_the_transparent_side_color_into_the_opaque_side() {
    // 32×32, colonnes 0..=16 opaques rouges, colonnes 17..31 transparentes mais peintes en vert :
    // la case de réduction 8 (colonnes source 16 et 17) est donc moitié opaque, moitié transparente.
    let source = rgba_from(32, 32, |x, _y| {
        if x <= 16 {
            [255, 0, 0, 255]
        } else {
            [0, 255, 0, 0]
        }
    });
    let pixels = reduce::pyramid(&source, None);
    let level0 = level_bytes(&pixels, 0);
    for row in 0..16usize {
        let at = (row * 16 + 8) * 4;
        let texel = &level0[at..at + 4];
        assert_eq!(
            texel[0], 255,
            "le rouge de la moitié opaque doit rester saturé"
        );
        assert_eq!(
            texel[1], 0,
            "le vert du côté transparent ne doit pas déteindre"
        );
        assert_eq!(
            texel[2], 0,
            "le bleu du côté transparent ne doit pas déteindre"
        );
        assert_eq!(
            texel[3], 128,
            "moitié des échantillons opaques : alpha à mi-course"
        );
    }
}
