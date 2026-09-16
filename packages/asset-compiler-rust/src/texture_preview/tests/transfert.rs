use super::*;

// Reproduction du constat 56, chez le consommateur : la chaîne d'aperçus ramenait tout octet reçu
// en linéaire par la courbe sRGB, quel que soit ce que le fichier avait déclaré. Une texture dont
// les échantillons sont déjà proportionnels à la lumière y était donc décodée une fois de trop, et
// ressortait assombrie. Les octets rendus doivent changer avec la déclaration, et eux seuls.
#[test]
fn le_meme_octet_declare_srgb_puis_lineaire_ne_donne_pas_le_meme_apercu() {
    let (width, height) = (2u32, 2u32);
    // Un gris moyen : c'est là que les deux courbes s'écartent le plus.
    let source = rgba_from(width, height, |_x, _y| [128, 128, 128, 255]);
    let (_, srgb) = reduce::pyramid(&source, Transfer::Srgb, None);
    let (_, linear) = reduce::pyramid(&source, Transfer::Linear, None);
    assert_ne!(srgb, linear, "la déclaration doit changer l'aperçu");
    // Des octets déclarés sRGB traversent la chaîne sans bouger : décodés puis réencodés par la
    // même courbe, ils retombent sur eux-mêmes. C'est le cas que le pilote prête par convention.
    assert_eq!(
        level_bytes(width, height, &srgb, 0),
        [128, 128, 128, 255].repeat(4),
        "aller-retour sRGB"
    );
    // Des octets déclarés linéaires sont la lumière elle-même : l'aperçu, qui est du sRGB, les y
    // encode, et un demi linéaire vaut bien plus qu'un demi sRGB.
    let encoded = level_bytes(width, height, &linear, 0);
    assert_eq!(encoded[3], 255, "l'alpha ne dépend d'aucune courbe");
    assert!(
        encoded[0] > 180,
        "un demi linéaire s'encode bien au-dessus de 128, pas {}",
        encoded[0]
    );
    for texel in encoded.chunks(4) {
        assert_eq!(
            texel,
            &encoded[..4],
            "la source est uniforme, l'aperçu aussi"
        );
    }
}
