//! La dorée du pilote TGA : chaque profil du format, décodé depuis un fichier réel de
//! `fixtures/tga/`, doit rendre exactement les mêmes pixels RGBA8 — écrits en clair ici. Origine,
//! compression et profondeur sont des façons d'écrire la même image, jamais de la changer.
use super::super::image as registry;
use super::fixture;
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// L'image de référence, 4 × 2 pixels, ligne du haut d'abord. Elle mêle alpha opaque, alpha partiel
/// et alpha nul pour que le moindre rognage du canal se voie.
const REFERENCE: [[u8; 4]; 8] = [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 255],
    [255, 255, 0, 64],
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [17, 34, 51, 68],
    [200, 100, 50, 150],
];

/// La même image sans canal alpha : ce que rendent les profils qui n'en portent pas.
fn opaque() -> Vec<[u8; 4]> {
    REFERENCE
        .iter()
        .map(|[r, g, b, _]| [*r, *g, *b, 255])
        .collect()
}

/// Les pixels d'une fixture, dans l'ordre de lecture de l'image décodée.
fn pixels(name: &str) -> Vec<[u8; 4]> {
    let bytes = fixture("tga", name);
    let decoder = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "tga", "{name}");
    let image =
        super::rgba8(registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|e| panic!("{name}: {e}")));
    assert_eq!((image.width(), image.height()), (4, 2), "{name}");
    image.pixels().map(|pixel| pixel.0).collect()
}

// Dorée du pilote TGA : les six profils que le pilote annonce lire rendent, pixel par pixel, la
// référence écrite en clair. Sans perte veut dire : pas un octet de différence.
#[test]
fn chaque_profil_tga_rend_les_pixels_de_la_reference() {
    let alpha = REFERENCE.to_vec();
    let opaque = opaque();
    for (name, expected) in [
        ("vraies-couleurs-32-haut.tga", &alpha),
        ("vraies-couleurs-32-rle-haut.tga", &alpha),
        ("vraies-couleurs-32-rle-bas.tga", &alpha),
        ("vraies-couleurs-24-bas.tga", &opaque),
        ("palette-8-haut.tga", &opaque),
    ] {
        assert_eq!(&pixels(name), expected, "{name}");
    }
    // Les niveaux de gris portent l'autre référence : une valeur par pixel, étendue aux trois
    // canaux, opaque. Le pilote ne la colore pas et ne la rééchelonne pas.
    let gris: Vec<[u8; 4]> = [0u8, 64, 128, 255, 16, 32, 48, 64]
        .iter()
        .map(|v| [*v, *v, *v, 255])
        .collect();
    assert_eq!(pixels("niveaux-de-gris-8-bas.tga"), gris);
}

// Contrat du pilote : ce qu'il reconnaît, ce qu'il refuse, et sous quel nom il le rapporte. Un TGA
// illisible laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation.
#[test]
fn un_tga_illisible_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["tga", "tpic", "TGA"] {
        let path = PathBuf::from(format!("albedo.{extension}"));
        let decoder = registry::by_extension(&path).expect("revendiqué");
        assert_eq!(decoder.name(), "tga", "{extension}");
        assert_eq!(decoder.mime(), "image/x-tga");
    }
    // Tronqué : l'entête est reconnu, donc le pilote est choisi, et c'est le décodage qui échoue.
    let tronque = fixture("tga", "tronque.tga");
    assert_eq!(
        registry::by_head(&tronque).map(|d| d.name()),
        Some("tga"),
        "l'entête d'un fichier tronqué reste un entête TGA"
    );
    assert_eq!(
        registry::decode(&tronque, MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
    // TGA n'a pas de nombre magique : sans entête cohérent, le pilote ne revendique rien. Une
    // largeur nulle, une palette annoncée sans type de palette, un type d'image inconnu et des
    // octets trop courts pour porter un entête sont autant de refus.
    for (case, head) in [
        (
            "largeur nulle",
            [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 24, 0],
        ),
        (
            "palette sans type",
            [0, 0, 2, 0, 0, 4, 0, 24, 0, 0, 0, 0, 4, 0, 2, 0, 24, 0],
        ),
        (
            "type inconnu",
            [0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2, 0, 24, 0],
        ),
        (
            "profondeur hors profil",
            [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2, 0, 12, 0],
        ),
    ] {
        assert_eq!(
            registry::decode(&head, MAX_ALLOC).err(),
            Some("image-format-unknown"),
            "{case}"
        );
    }
    assert!(
        registry::by_head(&tronque[..8]).is_none(),
        "entête incomplet"
    );
}
