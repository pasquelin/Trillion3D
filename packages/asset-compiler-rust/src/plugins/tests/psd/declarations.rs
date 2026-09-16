//! Ce qu'un PSD **déclare** autour de ses pixels, et que l'entête seul ne dit pas : le compte de
//! calques de la section des calques, un entier signé de seize bits dont le signe négatif annonce
//! que le premier plan d'alpha du composite porte la transparence du document.
//!
//! Sans cette déclaration, un plan de plus que les canaux de couleur est un canal alpha enregistré,
//! c'est-à-dire une sélection : le prendre pour de la transparence trouait la texture.
use super::super::super::image as registry;
use super::super::{fixture, rgba8};
use super::{avec_alpha, GRIS, MAX_ALLOC, RVB, SIZE};

/// Le décalage de la longueur de la section des calques dans une fixture PSD dont les deux sections
/// précédentes sont vides : vingt-six octets d'entête, puis deux longueurs nulles de quatre octets.
const LAYERS_AT: usize = 26 + 4 + 4;

/// La fixture, sa section de calques vide remplacée par une section qui porte un compte de calques
/// — l'entier signé de seize bits par lequel la spécification d'Adobe déclare, par son signe, que le
/// premier plan d'alpha du composite est la transparence du document. Le pilote ne lit que ce champ
/// et saute le reste de la section par sa longueur : ces cas ne prétendent donc pas écrire un
/// enregistrement de calque entier, ils mettent en défaut exactement le champ qui décide.
fn avec_compte_de_calques(name: &str, count: i16) -> Vec<u8> {
    let mut bytes = fixture("psd", name);
    let mut section = Vec::from(2u32.to_be_bytes());
    section.extend_from_slice(&count.to_be_bytes());
    bytes.splice(
        LAYERS_AT..LAYERS_AT + 4,
        (section.len() as u32)
            .to_be_bytes()
            .into_iter()
            .chain(section),
    );
    bytes
}

/// Les pixels et les raisons nommées d'octets construits par le test.
fn decode(case: &str, bytes: &[u8]) -> (Vec<[u8; 4]>, Vec<&'static str>) {
    let decoded =
        registry::decode(bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{case}: {erreur}"));
    let raisons = decoded.notes.clone();
    let image = rgba8(decoded);
    assert_eq!(image.dimensions(), SIZE, "{case}");
    (image.pixels().map(|pixel| pixel.0).collect(), raisons)
}

// Reproduction du constat 54 : un plan de plus que les canaux de couleur n'est de la transparence
// que si le fichier le déclare. La spécification d'Adobe le dit dans le compte de calques — un
// entier signé dont le négatif annonce « le premier canal alpha porte la transparence du composite ».
// Sans cette déclaration, le plan est un canal alpha enregistré, c'est-à-dire une sélection : le
// prendre pour de la transparence trouait la texture. Il est ignoré et compté.
#[test]
fn un_plan_de_plus_nest_de_la_transparence_que_si_le_fichier_le_declare() {
    // Aucune section de calques : les deux fixtures portent une sélection, pas une transparence.
    for (name, base) in [("rgba-rle.psd", RVB), ("gris-alpha-rle.psd", GRIS)] {
        let (rendus, raisons) = decode(name, &fixture("psd", name));
        assert_eq!(rendus, base.to_vec(), "{name} : l'alpha reste opaque");
        assert_eq!(raisons, vec!["psd-alpha-channel-ignored"], "{name}");
    }
    // Compte négatif : le composite porte bien la transparence du document, l'alpha est honoré.
    let (rendus, raisons) = decode(
        "rgba-rle.psd -1",
        &avec_compte_de_calques("rgba-rle.psd", -1),
    );
    assert_eq!(rendus, avec_alpha(RVB));
    assert_eq!(raisons, vec!["psd-layers-flattened"]);
    // Compte positif : les calques existent mais la transparence n'est pas déclarée. Le plan
    // redevient une sélection, et les deux raisons se comptent côte à côte.
    let (rendus, raisons) = decode(
        "rgba-rle.psd +2",
        &avec_compte_de_calques("rgba-rle.psd", 2),
    );
    assert_eq!(rendus, RVB.to_vec());
    assert_eq!(
        raisons,
        vec!["psd-alpha-channel-ignored", "psd-layers-flattened"]
    );
}

// Reproduction du constat 54, seconde moitié : le compte de calques n'était pas lu du tout, alors
// que seul le composite aplati sort du pilote. Un fichier qui porte des calques le dit désormais,
// même quand aucun plan d'alpha n'est en jeu.
#[test]
fn les_calques_dun_psd_sont_comptes_puisque_seul_le_composite_sort() {
    let (rendus, raisons) = decode("rgb-rle.psd +3", &avec_compte_de_calques("rgb-rle.psd", 3));
    assert_eq!(
        rendus,
        RVB.to_vec(),
        "les pixels du composite ne bougent pas"
    );
    assert_eq!(raisons, vec!["psd-layers-flattened"]);
    // Sans calque, rien n'est compté : un composite à trois canaux est exactement ce qu'il dit.
    assert!(decode("rgb-rle.psd", &fixture("psd", "rgb-rle.psd"))
        .1
        .is_empty());
}
