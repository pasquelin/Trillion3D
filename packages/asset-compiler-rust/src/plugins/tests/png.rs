//! La dorée du pilote PNG : la profondeur décide, et elle décide avant le décodage. Jusqu'à huit
//! bits par canal l'image ressort pixel pour pixel ; à seize elle est refusée en le nommant, comme
//! le TIFF 16 bits et pour la même raison — la sortie du contrat ne sait pas encore porter cette
//! précision, et la rogner en silence ajouterait une perte que la source n'avait pas.
use super::super::image as registry;
use super::{declared, fixture, rgba8};

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// L'image de référence, 2 × 2 pixels, ligne du haut d'abord. Les trois fixtures portent ce même
/// dessin, chacune dans une profondeur différente.
const REFERENCE: [[u8; 4]; 4] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
];

// Dorée du pilote PNG : les profondeurs qu'il lit — huit bits par canal, et en dessous la palette à
// quatre bits — rendent la même image, pixel pour pixel. Une profondeur est une façon d'écrire
// l'image, jamais de la changer, et le refus du 16 bits n'y a rien changé.
#[test]
fn chaque_profondeur_lue_rend_les_pixels_de_la_reference() {
    for name in ["rgb8.png", "palette4.png"] {
        let bytes = fixture("png", name);
        let pilote = registry::by_head(&bytes).expect("un pilote revendique ces octets");
        assert_eq!(pilote.name(), "png", "{name}");
        assert_eq!(pilote.mime(), "image/png", "{name}");
        let rendu = rgba8(
            registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{name}: {erreur}")),
        );
        assert_eq!((rendu.width(), rendu.height()), (2, 2), "{name}");
        assert_eq!(
            rendu.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
            REFERENCE,
            "{name}"
        );
    }
}

// Contrat du pilote : un PNG 16 bits par canal est refusé sous sa propre raison, lue dans l'IHDR
// avant tout décodage. Le rendre abaissé à huit bits serait ajouter une perte que la source n'avait
// pas ; le refus, lui, laisse simplement le moteur retomber sur son blanc et ne panique jamais.
#[test]
fn un_png_seize_bits_ressort_en_raison_de_rapport_jamais_rogne() {
    let bytes = fixture("png", "rgb16.png");
    assert_eq!(
        registry::by_head(&bytes).map(|pilote| pilote.name()),
        Some("png")
    );
    assert_eq!(
        registry::decode(&bytes, MAX_ALLOC).err(),
        Some("image-depth-unsupported")
    );
    // Ce refus a changé ce que le pilote produit, donc son identité de cache : la version le porte,
    // sans quoi une entrée écrite du temps de l'abaissement silencieux serait relue comme juste.
    assert_eq!(
        registry::by_head(&bytes).map(|pilote| pilote.version()),
        Some("png-image-0.25-depth8-apng-icc")
    );
    // C'est la profondeur qui refuse, pas la taille : la raison ne bouge pas avec le plafond
    // d'allocation, et elle sort sans qu'un seul pixel ait été décodé.
    assert_eq!(
        registry::decode(&bytes, 16).err(),
        Some("image-depth-unsupported")
    );
    // Un fichier trop court pour porter son IHDR n'est pas jugé sur sa profondeur : il reste jugé
    // par le décodeur, exactement comme avant ce refus.
    assert_eq!(
        registry::decode(b"\x89PNG\r\n\x1a\ntronque", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
}

// Reproduction du constat 8 : un APNG porte plusieurs images, le contrat n'en rend qu'une. La
// première ressort telle quelle — c'est l'image par défaut que la spécification APNG place dans
// `IDAT` —, et le fichier ayant déclaré une animation par son morceau `acTL`, le pilote le compte.
// Aplatir sans le dire laissait deux images entrer et une seule sortir, sans un mot au rapport.
#[test]
fn un_png_anime_rend_son_image_par_defaut_et_compte_lanimation() {
    let bytes = fixture("png", "anime.png");
    let rendu = rgba8(
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("anime.png: {erreur}")),
    );
    assert_eq!((rendu.width(), rendu.height()), (2, 2));
    // L'image par défaut est le rouge pur ; la seconde trame, verte, n'entre pas dans la sortie.
    assert_eq!(
        rendu.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
        vec![[255, 0, 0, 255]; 4]
    );
    let (transfert, raisons) = declared("png", "anime.png", MAX_ALLOC);
    assert_eq!(transfert, registry::Transfer::Srgb);
    assert_eq!(raisons, vec!["image-animation-first-frame"]);
    // Un PNG d'une seule image ne porte pas `acTL` : il ne compte rien.
    assert!(declared("png", "rgb8.png", MAX_ALLOC).1.is_empty());
}
