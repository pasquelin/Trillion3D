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
        Some("png-image-0.25-depth8-apng-icc-gama")
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

/// La même fixture, un morceau de plus glissé devant son `IDAT` — la place que la spécification
/// donne à `gAMA`, `sRGB` et `iCCP`. Le CRC est recalculé : un morceau faux serait refusé, et ce
/// n'est pas ce que ces cas mettent à l'épreuve.
fn with_chunk(name: &str, kind: &[u8], data: &[u8]) -> Vec<u8> {
    inserted(&fixture("png", name), kind, data)
}

/// La même, sur des octets déjà en main : c'est ainsi qu'un cas pose deux morceaux.
fn inserted(bytes: &[u8], kind: &[u8], data: &[u8]) -> Vec<u8> {
    let at = bytes
        .windows(4)
        .position(|window| window == b"IDAT")
        .expect("IDAT")
        - 4;
    let mut crc = flate2::Crc::new();
    crc.update(kind);
    crc.update(data);
    let mut out = bytes[..at].to_vec();
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc.sum().to_be_bytes());
    out.extend_from_slice(&bytes[at..]);
    out
}

/// Le morceau `gAMA` d'une gamma écrite en centièmes de millième, comme le fait le format.
fn gamma(hundred_thousandths: u32) -> Vec<u8> {
    hundred_thousandths.to_be_bytes().to_vec()
}

/// Ce que le pilote déclare autour des pixels de ces octets.
fn declares(bytes: &[u8]) -> (registry::Transfer, Vec<&'static str>) {
    let decoded = registry::decode(bytes, MAX_ALLOC).expect("décodé");
    (decoded.transfer, decoded.notes)
}

// Reproduction du constat A12 : un PNG qui déclare `gAMA = 100000` dit une gamma de 1, donc des
// échantillons proportionnels à la lumière — la spécification PNG l'écrit. Le pilote rendait
// pourtant `Srgb` sans un mot, et la chaîne d'aperçus décodait une seconde fois une image déjà
// linéaire. La courbe déclarée est maintenant portée, sous une priorité fixe : `iCCP`, puis le
// morceau `sRGB`, puis `gAMA`.
#[test]
fn la_courbe_declaree_par_les_morceaux_est_portee_par_le_contrat() {
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(100_000))),
        (registry::Transfer::Linear, vec![]),
        "une gamma de 1 dit des échantillons linéaires"
    );
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(45_455))),
        (registry::Transfer::Srgb, vec![]),
        "une gamma de 1/2,2 est celle de la courbe sRGB"
    );
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"sRGB", &[0])),
        (registry::Transfer::Srgb, vec![]),
        "le morceau sRGB dit la courbe de la sortie"
    );
    // Une gamma que le contrat ne sait pas porter : l'image sort traitée en sRGB, comme la
    // convention le veut pour un fichier qui se tait, et l'écart est compté par son nom.
    assert_eq!(
        declares(&with_chunk("rgb8.png", b"gAMA", &gamma(50_000))),
        (
            registry::Transfer::Srgb,
            vec!["image-transfer-unsupported"]
        ),
        "une courbe inhabituelle se compte"
    );
    // La priorité : un morceau `sRGB` l'emporte sur `gAMA`, un profil `iCCP` sur les deux — c'est
    // lui qui décrit la courbe, et il est déjà compté comme non converti.
    let tagged = with_chunk("rgb8.png", b"sRGB", &[0]);
    assert_eq!(
        declares(&inserted(&tagged, b"gAMA", &gamma(100_000))).0,
        registry::Transfer::Srgb,
        "le morceau sRGB l'emporte sur gAMA"
    );
    assert_eq!(
        declares(&with_chunk("icc-autre.png", b"gAMA", &gamma(100_000))),
        (
            registry::Transfer::Srgb,
            vec!["image-icc-profile-ignored"]
        ),
        "un profil colorimétrique l'emporte sur gAMA, et reste compté seul"
    );
    // Un fichier qui ne déclare rien garde la courbe que la convention lui prête.
    assert_eq!(
        declares(&fixture("png", "rgb8.png")),
        (registry::Transfer::Srgb, vec![])
    );
}
