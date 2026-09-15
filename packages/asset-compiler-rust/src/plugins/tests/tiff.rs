//! La dorée du pilote TIFF : chaque profil déclaré, décodé depuis un fichier réel de
//! `fixtures/tiff/`, rend exactement les mêmes pixels RGBA8 — écrits en clair ici. Ordre des
//! octets, compression et nombre de composantes sont des façons d'écrire la même image, jamais de
//! la changer. Et ce que le pilote ne déclare pas, il le refuse en le nommant : c'est la seconde
//! moitié du contrat, celle qui empêche un 16 bits de revenir rogné à huit.
use super::super::image as registry;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// L'image de référence, 4 × 2 pixels, ligne du haut d'abord.
const COULEURS: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 0, 0],
    [255, 255, 255],
    [17, 34, 51],
    [200, 100, 50],
];
/// Son canal alpha : opaque, partiel et nul mêlés, pour que le moindre rognage se voie.
const ALPHA: [u8; 8] = [255, 128, 255, 64, 0, 255, 68, 150];
/// L'autre référence, celle des profils à une seule composante.
const GRIS: [u8; 8] = [0, 64, 128, 255, 16, 32, 48, 64];

/// Ce que le registre rend pour cette fixture, dans l'ordre de lecture de l'image décodée.
fn rendus(name: &str) -> Vec<[u8; 4]> {
    super::decoded_rgba8("tiff", name, MAX_ALLOC, (4, 2))
        .pixels()
        .map(|pixel| pixel.0)
        .collect()
}

// Dorée du pilote TIFF : les sept écritures des trois profils déclarés rendent, pixel par pixel, la
// référence écrite en clair. Sans perte veut dire : pas un octet de différence.
#[test]
fn chaque_profil_tiff_declare_rend_les_pixels_de_la_reference() {
    // RGB8 : les deux ordres d'octets et les quatre compressions sans perte ne sont que cinq
    // façons d'écrire la même image. L'alpha absent du format est rempli à 255, pas inventé.
    let rgb: Vec<[u8; 4]> = COULEURS.iter().map(|[r, v, b]| [*r, *v, *b, 255]).collect();
    for name in [
        "rgb8-brut-ii.tiff",
        "rgb8-brut-mm.tiff",
        "rgb8-lzw.tiff",
        "rgb8-deflate.tiff",
        "rgb8-packbits.tiff",
    ] {
        assert_eq!(rendus(name), rgb, "{name}");
    }
    // RGBA8 à alpha non associé : les quatre octets passent tels quels, alpha nul compris.
    let rgba: Vec<[u8; 4]> = COULEURS
        .iter()
        .zip(ALPHA)
        .map(|([r, v, b], a)| [*r, *v, *b, a])
        .collect();
    assert_eq!(rendus("rgba8-brut.tiff"), rgba);
    // Gris 8 bits, noir à zéro : la valeur va sur les trois canaux, sans teinte ni rééchelonnement.
    let gris: Vec<[u8; 4]> = GRIS.iter().map(|v| [*v, *v, *v, 255]).collect();
    assert_eq!(rendus("gris8-brut.tiff"), gris);
}

// Contrat du pilote : ce qu'il reconnaît, ce qu'il refuse, et sous quel nom il le rapporte. TIFF est
// un conteneur de champs, donc la moitié du travail est de dire non ; un TIFF refusé laisse le
// moteur retomber sur son blanc, il n'interrompt aucune compilation et ne panique jamais.
#[test]
fn un_tiff_hors_profil_ressort_en_raison_de_rapport_jamais_en_panique() {
    super::assert_claims("tiff", "image/tiff", &["tif", "tiff", "TIFF"]);
    super::assert_refusals(
        "tiff",
        MAX_ALLOC,
        &[
            // Le 16 bits a sa propre raison : la sortie du contrat ne sait pas encore le porter, et
            // l'abaisser à huit en silence ajouterait une perte que la source n'avait pas.
            ("gris16.tiff", "image-depth-unsupported"),
            // Profils valides mais hors de ceux que le pilote déclare lire.
            ("palette8.tiff", "image-profile-unsupported"),
            ("rgb8-jpeg.tiff", "image-profile-unsupported"),
            ("ccitt-g4.tiff", "image-profile-unsupported"),
            ("deux-pages.tiff", "image-profile-unsupported"),
            ("rgb8-plans-separes.tiff", "image-profile-unsupported"),
            // Alpha associé : prémultiplié, donc pas l'alpha droit du contrat. Le rendre tel quel
            // changerait les couleurs, et le démultiplier serait une autre opération que ce pilote
            // n'annonce pas.
            ("rgba8-alpha-associe.tiff", "image-profile-unsupported"),
            // Tronqué : l'entête est un entête TIFF, donc le pilote est choisi et c'est la lecture
            // qui échoue.
            ("tronque.tif", "image-decode-failed"),
        ],
    );
    // BigTIFF partage l'extension et presque l'entête ; ses adresses tiennent sur huit octets,
    // c'est un autre format. Le pilote le revendique pour le nommer, plutôt que de le laisser
    // sortir en format inconnu.
    for entete in [b"II\x2b\x00\x08\x00\x00\x00", b"MM\x00\x2b\x00\x08\x00\x00"] {
        assert_eq!(
            registry::by_head(entete).map(|pilote| pilote.name()),
            Some("tiff")
        );
        assert_eq!(
            registry::decode(entete, MAX_ALLOC).err(),
            Some("image-profile-unsupported")
        );
    }
    // Sans nombre magique complet, le pilote ne revendique rien : ces octets ressortent en format
    // inconnu, pas en TIFF illisible.
    for head in [b"II\x00\x00".as_slice(), b"MM\x2a\x00", b"II\x2a"] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
