use super::*;

// Comportement 1 : la chaîne est linéaire prémultipliée de bout en bout, si bien qu'une texture
// semi-transparente à bord dur ne fait pas saigner sa couleur transparente ("poison") dans les
// texels opaques voisins qui partagent une même case de réduction.
#[test]
fn a_hard_edge_does_not_bleed_the_transparent_side_color_into_the_opaque_side() {
    // 32×32, colonnes 0..=16 opaques rouges, colonnes 17..31 transparentes mais peintes en vert :
    // au niveau 16×16 la case 8 (colonnes source 16 et 17) est moitié opaque, moitié transparente.
    let (width, height) = (32u32, 32u32);
    let source = rgba_from(width, height, |x, _y| {
        if x <= 16 {
            [255, 0, 0, 255]
        } else {
            [0, 255, 0, 0]
        }
    });
    let (_first, pixels) = reduce::pyramid(&source, Transfer::Srgb, None);
    assert_eq!(level_size(width, height, 1), (16, 16));
    let level = level_bytes(width, height, &pixels, 1);
    for row in 0..16usize {
        let at = (row * 16 + 8) * 4;
        let texel = &level[at..at + 4];
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
