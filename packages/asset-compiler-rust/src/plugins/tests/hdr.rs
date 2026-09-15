//! La dorée du pilote Radiance HDR : les fichiers de `fixtures/hdr/`, écrits ici depuis la
//! spécification publique, doivent rendre exactement les valeurs flottantes écrites en clair
//! ci-dessous. Ligne brute, compression ancienne et compression nouvelle sont trois façons d'écrire
//! la même ligne — le doré le prouve en comparant leurs pixels à la même référence.
use super::super::image as registry;
use super::{fixture, rgba_f32};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// Les quatre pixels dont les fixtures sont faites, en RGBA linéaire. Chacun vient d'un quadruplet
/// RGBE dont l'exposant est lisible à l'œil : `(128, 64, 32, 128)` vaut `2^-8` fois ses mantisses,
/// `(0, 128, 0, 140)` vaut `2^4` fois les siennes, et l'alpha est opaque partout.
const PALE: [f32; 4] = [0.5, 0.25, 0.125, 1.0];
const BLANC: [f32; 4] = [1.9921875, 1.9921875, 1.9921875, 1.0];
const VERT_VIF: [f32; 4] = [0.0, 2048.0, 0.0, 1.0];
const GRIS: [f32; 4] = [128.0, 128.0, 128.0, 1.0];

/// L'image de référence des fixtures 4 × 2, ligne du haut d'abord : trois pixels identiques puis un
/// autre, pour qu'une plage et un paquet brut se suivent dans la même ligne.
const REFERENCE_4X2: [[f32; 4]; 8] = [PALE, PALE, PALE, BLANC, VERT_VIF, GRIS, GRIS, GRIS];

/// L'image de référence de la fixture 8 × 1 : la nouvelle compression ne s'écrit qu'au-delà de huit
/// pixels de large, et celle-ci porte une plage de quatre puis des valeurs isolées.
const REFERENCE_8X1: [[f32; 4]; 8] = [PALE, PALE, PALE, PALE, BLANC, VERT_VIF, GRIS, GRIS];

/// Les pixels d'une fixture, dans l'ordre de lecture de l'image décodée.
fn pixels(name: &str, size: (u32, u32)) -> Vec<[f32; 4]> {
    let bytes = fixture("hdr", name);
    let decoder = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "hdr", "{name}");
    let (width, height, data) =
        rgba_f32(registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|e| panic!("{name}: {e}")));
    assert_eq!((width, height), size, "{name}");
    data.as_chunks::<4>().0.to_vec()
}

// Dorée du pilote : les trois écritures d'une ligne et les deux signatures du format rendent, valeur
// par valeur, la même image. Sans perte veut dire : pas un bit de mantisse de différence.
#[test]
fn les_trois_ecritures_dune_ligne_rendent_les_valeurs_de_la_reference() {
    for name in ["plat.hdr", "rle-ancienne.hdr", "signature-rgbe.hdr"] {
        assert_eq!(pixels(name, (4, 2)), REFERENCE_4X2.to_vec(), "{name}");
    }
    assert_eq!(
        pixels("rle-nouvelle.hdr", (8, 1)),
        REFERENCE_8X1.to_vec(),
        "la compression par composantes rend la même image que les autres"
    );
}

// Contrat du pilote : ce qu'il revendique, et ce qu'il refuse en le nommant. Un HDR hors
// sous-ensemble laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation.
#[test]
fn ce_qui_sort_du_sous_ensemble_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["hdr", "rgbe", "pic", "HDR"] {
        let path = PathBuf::from(format!("environnement.{extension}"));
        let claimed = registry::by_extension(&path).expect("revendiqué");
        assert_eq!(claimed.name(), "hdr", "{extension}");
        assert_eq!(claimed.mime(), "image/vnd.radiance");
    }
    for (name, reason) in [
        ("xyze.hdr", "hdr-format-unsupported"),
        ("bas-en-haut.hdr", "hdr-orientation-unsupported"),
        ("tronque.hdr", "hdr-data-truncated"),
    ] {
        let bytes = fixture("hdr", name);
        assert_eq!(
            registry::by_head(&bytes).map(|d| d.name()),
            Some("hdr"),
            "{name}: la signature reste celle d'un Radiance"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(reason),
            "{name}"
        );
    }
    // Sans signature, le pilote ne revendique rien : mieux vaut un format inconnu que les octets
    // volés à un voisin.
    assert!(registry::by_head(b"#?AUTRECHOSE\n").is_none());
}

// Contrat du pilote : le plafond d'allocation compte seize octets par pixel, ceux de la variante
// flottante. Une image qui n'y tient pas est un refus nommé, jamais une allocation tentée.
#[test]
fn le_plafond_dallocation_compte_seize_octets_par_pixel() {
    let bytes = fixture("hdr", "plat.hdr");
    assert_eq!(
        registry::decode(&bytes, 127).err(),
        Some("hdr-image-too-large"),
        "huit pixels flottants pèsent cent vingt-huit octets"
    );
    assert!(
        registry::decode(&bytes, 128).is_ok(),
        "juste assez de place"
    );
}
