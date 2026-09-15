//! La dorée du pilote PSD : les fixtures de `fixtures/psd/`, écrites ici depuis la spécification
//! publiée par Adobe pour les lecteurs tiers, doivent rendre exactement les pixels écrits en clair
//! ci-dessous. Surface brute et lignes compressées par plages sont deux façons d'écrire le même
//! composite, en PSD comme en PSB — le doré le prouve en les comparant à la même référence.
use super::super::image as registry;
use super::{fixture, rgba8};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// Les dimensions de toutes les fixtures : deux lignes de quatre pixels, la plus petite image où
/// une plage de trois pixels et un pixel isolé tiennent dans la même ligne compressée.
const SIZE: (u32, u32) = (4, 2);

/// Le composite de référence en RVB, ligne du haut d'abord : trois pixels identiques puis un autre,
/// pour qu'une plage et un paquet brut se suivent dans la même ligne. L'alpha est opaque : les
/// fixtures à trois canaux n'en portent pas de plan, et le pilote ne l'invente pas.
const RVB: [[u8; 4]; 8] = [
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [200, 100, 50, 255],
    [0, 255, 0, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
];

/// Le même composite en niveaux de gris : l'unique canal de couleur porte les trois composantes,
/// sans qu'aucune matrice ni aucun profil n'intervienne.
const GRIS: [[u8; 4]; 8] = [
    [10, 10, 10, 255],
    [10, 10, 10, 255],
    [10, 10, 10, 255],
    [200, 200, 200, 255],
    [0, 0, 0, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 255],
];

/// Le plan d'alpha des fixtures qui en portent un : un pixel transparent dans la première ligne,
/// une plage à un quart d'opacité dans la seconde.
const ALPHA: [u8; 8] = [255, 255, 255, 0, 64, 64, 64, 64];

/// La référence, son plan d'alpha posé par-dessus.
fn avec_alpha(base: [[u8; 4]; 8]) -> Vec<[u8; 4]> {
    base.iter()
        .zip(ALPHA)
        .map(|(pixel, alpha)| [pixel[0], pixel[1], pixel[2], alpha])
        .collect()
}

/// Les pixels d'une fixture, dans l'ordre de lecture de l'image décodée.
fn pixels(name: &str) -> Vec<[u8; 4]> {
    let bytes = fixture("psd", name);
    let decoder = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "psd", "{name}");
    let image = rgba8(
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|error| panic!("{name}: {error}")),
    );
    assert_eq!(image.dimensions(), SIZE, "{name}");
    image.pixels().map(|pixel| pixel.0).collect()
}

// Dorée du pilote : les deux écritures du composite et les deux versions du format rendent, pixel
// par pixel, la même image. Aplati veut dire : ce que le fichier porte déjà, et rien d'autre.
#[test]
fn les_deux_ecritures_du_composite_rendent_les_pixels_de_la_reference() {
    for name in ["rgb-brut.psd", "rgb-rle.psd", "grand-format.psb"] {
        assert_eq!(pixels(name), RVB.to_vec(), "{name}");
    }
    assert_eq!(
        pixels("gris-brut.psd"),
        GRIS.to_vec(),
        "un canal de couleur porte les trois composantes"
    );
}

// Comportement du pilote : le plan qui suit les canaux de couleur est l'alpha du composite, lu tel
// quel et droit — aucune couleur n'est démultipliée, aucun pixel transparent n'est repeint.
#[test]
fn le_plan_qui_suit_les_canaux_de_couleur_est_lalpha_du_composite() {
    assert_eq!(pixels("rgba-rle.psd"), avec_alpha(RVB), "rgba-rle.psd");
    assert_eq!(
        pixels("gris-alpha-rle.psd"),
        avec_alpha(GRIS),
        "gris-alpha-rle.psd"
    );
}

// Contrat du pilote : ce qu'il revendique, et ce qu'il refuse en le nommant. Un PSD hors
// sous-ensemble laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation.
#[test]
fn ce_qui_sort_du_sous_ensemble_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["psd", "psb", "PSD"] {
        let path = PathBuf::from(format!("couleur-de-base.{extension}"));
        let claimed = registry::by_extension(&path).expect("revendiqué");
        assert_eq!(claimed.name(), "psd", "{extension}");
        assert_eq!(claimed.mime(), "image/vnd.adobe.photoshop");
    }
    for (name, reason) in [
        ("seize-bits.psd", "psd-depth-unsupported"),
        ("cmjn.psd", "psd-color-mode-unsupported"),
        ("canaux-en-trop.psd", "psd-channels-unsupported"),
        ("zip.psd", "psd-compression-unsupported"),
        ("sans-composite.psd", "psd-composite-missing"),
        ("tronque.psd", "psd-data-truncated"),
    ] {
        let bytes = fixture("psd", name);
        assert_eq!(
            registry::by_head(&bytes).map(|decoder| decoder.name()),
            Some("psd"),
            "{name}: la signature reste celle d'un Photoshop"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(reason),
            "{name}"
        );
    }
    // Sans la signature et son numéro de version, le pilote ne revendique rien : mieux vaut un
    // format inconnu que les octets volés à un voisin.
    assert!(registry::by_head(b"8BPS\0\x09").is_none());
}

// Contrat du pilote : un entête dont un champ sort de son domaine est nommé, jamais deviné. La
// largeur nulle est le cas que le reste du pilote ne peut pas rattraper.
#[test]
fn un_entete_hors_domaine_est_refuse_par_son_nom() {
    let mut bytes = fixture("psd", "rgb-brut.psd");
    bytes[18..22].fill(0);
    assert_eq!(
        registry::decode(&bytes, MAX_ALLOC).err(),
        Some("psd-header-invalid"),
        "une largeur nulle n'est pas une image"
    );
}

// Contrat du pilote : le plafond d'allocation compte quatre octets par pixel, ceux du contrat de
// sortie. Une image qui n'y tient pas est un refus nommé, jamais une allocation tentée.
#[test]
fn le_plafond_dallocation_compte_quatre_octets_par_pixel() {
    let bytes = fixture("psd", "rgb-brut.psd");
    assert_eq!(
        registry::decode(&bytes, 31).err(),
        Some("psd-image-too-large"),
        "huit pixels RGBA8 pèsent trente-deux octets"
    );
    assert!(registry::decode(&bytes, 32).is_ok(), "juste assez de place");
}
