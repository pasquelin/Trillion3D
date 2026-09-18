use super::*;

// Comportement 1 : la courbe est celle de l'ATLAS, pas celle du fichier. Les trois canaux de
// couleur d'un atlas couleur (`rgba8unorm-srgb`) se moyennent en linéaire puis se réencodent ;
// ceux d'un atlas de données (`rgba8unorm`) se moyennent tels quels. Le même octet donne donc deux
// niveaux différents selon l'atlas qui le lira — et c'est ce que la carte faisait déjà.
#[test]
fn the_same_bytes_reduce_differently_for_each_atlas() {
    // Un damier noir et blanc : la moyenne linéaire d'un 0 et d'un 255 sRGB vaut 0,5 en lumière,
    // soit 188 une fois réencodé ; en données, c'est 128 tout court.
    let source = rgba_from(2, 2, |x, y| {
        let v = if (x + y) % 2 == 0 { 255 } else { 0 };
        [v, v, v, 255]
    });
    let color = reduce::chain(&source, AtlasKind::Color);
    let data = reduce::chain(&source, AtlasKind::Data);
    assert_eq!(
        &color[1][..3],
        &[188, 188, 188],
        "moyenne en lumière, réencodée sRGB"
    );
    assert_eq!(
        &data[1][..3],
        &[128, 128, 128],
        "moyenne des octets tels quels"
    );
    assert_eq!(color[1][3], 255);
    assert_eq!(data[1][3], 255);
}

// Comportement 2 : la couleur d'un texel transparent ENTRE dans la moyenne, comme dans le
// nuanceur — la chaîne n'est pas prémultipliée. C'est un choix de fidélité à l'image existante,
// pas d'image idéale : la prémultiplication est le lot « filtre de mips » de la TODO, à juger
// à l'œil avec des captures, et ce test cessera d'être vrai le jour où il est livré.
#[test]
fn a_transparent_texel_color_enters_the_mean_as_on_the_card() {
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

// Comportement 3 : le niveau suivant se calcule depuis les OCTETS du précédent, jamais depuis un
// flottant gardé de côté — c'est ce que la carte lit, et deux chaînes qui partent des mêmes octets
// de niveau `k` donnent le même niveau `k + 1`, quel que soit le chemin qui a mené à `k`.
#[test]
fn each_level_is_derived_from_the_quantized_previous_level() {
    let source = rgba_from(8, 8, |x, y| [((x * 37 + y * 11) % 256) as u8, 7, 200, 255]);
    let chain = reduce::chain(&source, AtlasKind::Color);
    let level1 = image::RgbaImage::from_raw(4, 4, chain[1].clone()).expect("niveau 1");
    let from_level1 = reduce::chain(&level1, AtlasKind::Color);
    assert_eq!(chain[2..], from_level1[1..]);
}
