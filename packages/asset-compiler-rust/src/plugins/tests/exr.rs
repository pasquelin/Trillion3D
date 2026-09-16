//! La dorée du pilote OpenEXR : les fichiers de `fixtures/exr/`, écrits ici depuis la spécification
//! publique, doivent rendre exactement les valeurs flottantes écrites en clair ci-dessous — demi et
//! simple précision confondues, puisque le demi-flottant s'étend en `f32` sans arrondi. Et ce qui
//! sort du sous-ensemble doit ressortir par son nom, jamais en panique ni en image approchée.
use super::super::image as registry;
use super::{fixture, rgba_f32};
use std::path::PathBuf;

/// Quatre pixels suffisent pour tenir l'ordre de lecture, les quatre canaux et le cas de l'alpha
/// absent ; les valeurs sont exactes dans les deux précisions, donc un écart vient du pilote.
const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Ce que les fichiers **portent**, 2 × 2, ligne du haut d'abord, RGBA : des échantillons associés
/// à leur alpha, comme la spécification d'OpenEXR les définit.
const STOCKE: [[f32; 4]; 4] = [
    [1.0, 0.5, 0.25, 1.0],
    [0.0, 2.0, 4.0, 0.5],
    [8.0, 0.125, 16.0, 0.0],
    [0.75, 1.5, 3.0, 0.25],
];

/// Ce que le contrat **rend** : les mêmes échantillons à alpha droit. Chaque composante est divisée
/// par l'alpha du pixel ; le pixel d'alpha nul garde les siennes, faute de quoi les diviser. Les
/// quotients sont exacts en simple précision, donc un écart ne peut venir que du pilote.
const DROIT: [[f32; 4]; 4] = [
    [1.0, 0.5, 0.25, 1.0],
    [0.0, 4.0, 8.0, 0.5],
    [8.0, 0.125, 16.0, 0.0],
    [3.0, 6.0, 12.0, 0.25],
];

/// Les pixels d'une fixture, dans l'ordre de lecture de l'image décodée.
fn pixels(name: &str) -> Vec<[f32; 4]> {
    let bytes = fixture("exr", name);
    let decoder = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "exr", "{name}");
    let (width, height, data) =
        rgba_f32(registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|e| panic!("{name}: {e}")));
    assert_eq!((width, height), (2, 2), "{name}");
    data.as_chunks::<4>().0.to_vec()
}

// Dorée du pilote : les deux précisions du sous-ensemble rendent la même image, valeur par valeur,
// et un fichier sans canal alpha rend l'alpha opaque que prescrit la spécification — pas un zéro.
#[test]
fn les_deux_precisions_rendent_les_valeurs_de_la_reference() {
    assert_eq!(pixels("demi.exr"), DROIT.to_vec());
    // Sans canal `A`, l'alpha est opaque : diviser par un ne change rien, les RGB sortent tels quels.
    let opaque: Vec<[f32; 4]> = STOCKE
        .iter()
        .map(|[r, g, b, _]| [*r, *g, *b, 1.0])
        .collect();
    assert_eq!(pixels("flottant.exr"), opaque);
}

// Reproduction du constat 53 : l'alpha d'un OpenEXR est associé — la spécification de l'Academy
// Software Foundation dit les RGB prémultipliés —, alors que le contrat de sortie demande un alpha
// droit. Rendre les échantillons tels quels livrait une image deux fois prémultipliée en aval, où
// l'aperçu prémultiplie à son tour. Ici chaque composante est divisée par l'alpha du pixel, et le
// pixel d'alpha nul ne divise rien : il n'y a pas de couleur droite à retrouver sous un alpha nul.
#[test]
fn lalpha_associe_dun_exr_ressort_droit_sans_diviser_par_zero() {
    let rendu = pixels("demi.exr");
    for (pixel, (stocke, droit)) in rendu.iter().zip(STOCKE.iter().zip(DROIT)) {
        assert_eq!(*pixel, droit, "stocké {stocke:?}");
    }
    // Les deux pixels dont l'alpha n'est ni 0 ni 1 sont ceux qui bougent : la dorée le dit tout haut
    // plutôt que de laisser croire que la division est sans effet.
    assert_ne!(rendu[1], STOCKE[1]);
    assert_ne!(rendu[3], STOCKE[3]);
    // L'alpha nul garde ses composantes : aucune division, aucun infini, aucun NaN.
    assert_eq!(rendu[2], STOCKE[2]);
    assert!(rendu.iter().flatten().all(|value| value.is_finite()));
}

// Contrat du pilote : ce qu'il revendique, et ce qu'il refuse en le nommant. Un EXR hors
// sous-ensemble laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation.
#[test]
fn ce_qui_sort_du_sous_ensemble_ressort_en_raison_de_rapport_jamais_en_panique() {
    let claimed = registry::by_extension(&PathBuf::from("environnement.EXR")).expect("revendiqué");
    assert_eq!(claimed.name(), "exr");
    assert_eq!(claimed.mime(), "image/x-exr");
    for (name, reason) in [
        ("profond.exr", "exr-deep-unsupported"),
        ("multi-parties.exr", "exr-multipart-unsupported"),
        ("canaux-xyz.exr", "exr-channels-unsupported"),
        ("tronque.exr", "exr-header-invalid"),
    ] {
        let bytes = fixture("exr", name);
        assert_eq!(
            registry::by_head(&bytes).map(|d| d.name()),
            Some("exr"),
            "{name}: le nombre magique reste celui d'un EXR"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(reason),
            "{name}"
        );
    }
}

// Contrat du pilote : le plafond d'allocation compte seize octets par pixel, ceux de la variante
// flottante. Une image qui n'y tient pas est un refus nommé, jamais une allocation tentée.
#[test]
fn le_plafond_dallocation_compte_seize_octets_par_pixel() {
    let bytes = fixture("exr", "demi.exr");
    assert_eq!(
        registry::decode(&bytes, 63).err(),
        Some("exr-image-too-large"),
        "quatre pixels flottants pèsent soixante-quatre octets"
    );
    assert!(registry::decode(&bytes, 64).is_ok(), "juste assez de place");
}
