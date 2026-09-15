use super::*;

// Comportement 3 (a) : une image plus petite que 16 px réplique ses propres texels ; ici chaque
// texel source d'une image 4×4 doit couvrir exactement un bloc 4×4 du niveau 16×16.
#[test]
fn a_source_smaller_than_16px_replicates_its_own_texels() {
    let source = rgba_from(4, 4, |x, y| [(x * 60) as u8, (y * 60) as u8, 10, 255]);
    let pixels = reduce::pyramid(&source, None);
    let level0 = level_bytes(&pixels, 0);
    for row in 0..16usize {
        for column in 0..16usize {
            let at = (row * 16 + column) * 4;
            let expected = source.get_pixel((column / 4) as u32, (row / 4) as u32);
            assert_eq!(
                level0[at], expected[0],
                "rouge répliqué en ({row},{column})"
            );
            assert_eq!(
                level0[at + 1],
                expected[1],
                "vert répliqué en ({row},{column})"
            );
            assert_eq!(level0[at + 3], 255);
        }
    }
}

// Comportement 3 (b) : des dimensions qui ne sont multiples ni de 16 ni l'une de l'autre (17×9, la
// hauteur restant sous 16) ne font pas planter la réduction, et une couleur uniforme y survit
// exactement quelle que soit la forme irrégulière des cases de réduction.
#[test]
fn dimensions_not_a_multiple_of_16_reduce_without_panicking() {
    let source = rgba_from(17, 9, |_x, _y| [37, 201, 88, 255]);
    let pixels = reduce::pyramid(&source, None);
    assert_eq!(pixels.len(), PREVIEW_BYTES);
    let level0 = level_bytes(&pixels, 0);
    for texel in level0.chunks(4) {
        assert_eq!(texel, [37, 201, 88, 255]);
    }
}
