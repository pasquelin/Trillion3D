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

/// L'image de référence, 2 × 2, ligne du haut d'abord, RGBA.
const REFERENCE: [[f32; 4]; 4] = [
    [1.0, 0.5, 0.25, 1.0],
    [0.0, 2.0, 4.0, 0.5],
    [8.0, 0.125, 16.0, 0.0],
    [0.75, 1.5, 3.0, 0.25],
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
    assert_eq!(pixels("demi.exr"), REFERENCE.to_vec());
    let opaque: Vec<[f32; 4]> = REFERENCE
        .iter()
        .map(|[r, g, b, _]| [*r, *g, *b, 1.0])
        .collect();
    assert_eq!(pixels("flottant.exr"), opaque);
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
