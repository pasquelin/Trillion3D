//! La dorée du pilote BMP : huit écritures du format rendent la même image de quatre par deux, et
//! ce que le décodeur rognerait est refusé avant d'être lu. C'est la seconde moitié qui compte : un
//! masque de plus de huit bits par canal n'entre pas, parce qu'entrer lui coûterait ses bits de
//! poids faible — une perte que la source n'avait pas.
use super::super::image as registry;
use super::{assert_claims, assert_refusals, decoded_rgba8, fixture};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// L'image de référence, ligne du haut d'abord : quatre couleurs franches puis trois mélanges dont
/// chaque composante est exactement portée par cinq bits, et chaque vert aussi par six. C'est ce qui
/// permet aux deux écritures 16 bits de rendre ces octets-là et pas leurs voisins.
const REFERENCE: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [0, 0, 0],
    [247, 206, 8],
    [16, 49, 239],
    [132, 239, 66],
];
/// Un bit ne porte que deux couleurs : ce fichier a sa propre référence, un damier.
const DAMIER: [[u8; 3]; 8] = [
    [255, 255, 255],
    [0, 0, 0],
    [255, 255, 255],
    [0, 0, 0],
    [0, 0, 0],
    [255, 255, 255],
    [0, 0, 0],
    [255, 255, 255],
];
/// L'alpha du seul fichier qui en porte un : les masques de l'entête V3 le déclarent, et le pilote
/// le rend droit — ni prémultiplié, ni rempli d'office.
const ALPHA_32: [u8; 8] = [255, 255, 255, 255, 255, 255, 128, 0];
const OPAQUE: [u8; 8] = [255; 8];

/// Les octets RGBA8 qu'une fixture doit rendre : la référence, et l'alpha qui lui est propre.
fn expected(colours: &[[u8; 3]; 8], alpha: &[u8; 8]) -> Vec<u8> {
    colours
        .iter()
        .zip(alpha)
        .flat_map(|(colour, alpha)| [colour[0], colour[1], colour[2], *alpha])
        .collect()
}

/// L'image que le registre rend pour cette fixture, dimensions vérifiées au passage.
fn rendu(name: &str) -> image::RgbaImage {
    decoded_rgba8("bmp", name, MAX_ALLOC, (4, 2))
}

// Dorée du pilote BMP : huit écritures du format — deux profondeurs de vraies couleurs, trois
// palettes, une compression par plages et deux répartitions de bits sur seize — portent la même
// image, et rendent les mêmes octets. L'ordre des lignes en fait partie : la 24 bits est stockée
// bas-haut et la 32 bits haut-bas, et c'est bien la même image qui en ressort.
#[test]
fn toutes_les_ecritures_du_format_rendent_les_memes_pixels() {
    for name in [
        "vraies-couleurs-24-bas.bmp",
        "palette-8.bmp",
        "palette-8-rle.bmp",
        "palette-4.bmp",
        "r5g5b5.bmp",
        "r5g6b5.bmp",
    ] {
        assert_eq!(
            rendu(name).as_raw(),
            &expected(&REFERENCE, &OPAQUE),
            "{name} : les pixels divergent de la référence"
        );
    }
    // La seule fixture à porter un alpha : hauteur négative, donc stockée haut-bas, et masques de
    // l'entête V3 — dont le masque alpha, que les entêtes plus courts n'ont pas.
    assert_eq!(
        rendu("vraies-couleurs-32-haut.bmp").as_raw(),
        &expected(&REFERENCE, &ALPHA_32),
        "l'alpha des 32 bits doit être rendu droit, sans remplissage ni prémultiplication"
    );
    assert_eq!(
        rendu("palette-1.bmp").as_raw(),
        &expected(&DAMIER, &OPAQUE),
        "une palette d'un bit porte deux couleurs, et les deux doivent être les bonnes"
    );
}

// Contrat du pilote : ce qu'il reconnaît, ce qu'il refuse, et sous quel nom il le rapporte. Un BMP
// refusé laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation et ne panique
// jamais. La règle de fidélité écarte ici tout ce que le décodeur aurait rogné : un masque plus
// large que huit bits perdrait ses bits de poids faible, et une charge JPEG ou PNG embarquée n'est
// pas du BMP mais un autre format, qui a son propre pilote.
#[test]
fn un_bmp_hors_politique_ressort_en_raison_de_rapport_jamais_en_panique() {
    assert_claims("bmp", "image/bmp", &["bmp", "BMP", "dib", "rle"]);
    assert_refusals(
        "bmp",
        MAX_ALLOC,
        &[
            // Masques 10-10-10 : le décodeur ne garderait que les huit bits de poids fort de chaque
            // canal. Refusé avant tout décodage, donc sans jamais produire les pixels appauvris.
            ("masques-10-bits.bmp", "bmp-bitfields-lossy"),
            ("jpeg-embarque.bmp", "bmp-embedded-codec-unsupported"),
            // Tronqué : l'entête reste un entête BMP, donc le pilote est bien choisi, et c'est la
            // lecture des pixels qui s'arrête faute d'octets.
            ("tronque.bmp", "image-decode-failed"),
        ],
    );
    // Deux entêtes réécrits sur une fixture lisible, pour les refus qu'aucun fichier ne porte : une
    // profondeur hors des profils sans perte, et une compression hors du format lu.
    let profondeur_at = 28;
    let compression_at = 30;
    for (at, valeur, raison) in [
        (profondeur_at, 64u32, "bmp-depth-unsupported"),
        // `BI_ALPHABITFIELDS`, que ce pilote ne lit pas.
        (compression_at, 6, "bmp-compression-unsupported"),
    ] {
        let mut altere = fixture("bmp", "vraies-couleurs-24-bas.bmp");
        altere[at..at + 4].copy_from_slice(&valeur.to_le_bytes());
        assert_eq!(registry::decode(&altere, MAX_ALLOC).err(), Some(raison));
    }
    // « BM » est la seule signature que ce pilote revendique : sans elle, ces octets ressortent en
    // format inconnu plutôt qu'en BMP illisible.
    for head in [
        b"BA\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".as_slice(),
        b"BM",
    ] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
