//! G10 — la géométrie d'une entrée de preview, déduite d'un seul couple de bornes au lieu de trois
//! appels qui repartent chacun des dimensions source. Le candidat est écrit ici et non dans la
//! bibliothèque : il rend exactement les mêmes nombres, mais ne gagne rien. `preview_first_level`
//! et `preview_last_level` sont de petites fonctions pures que le compilateur natif intègre puis
//! factorise lui-même, si bien que la redondance du source n'existe déjà plus dans le binaire.
use super::harness::{compare, Bits, Row};
use crate::texture_preview::{preview_first_level, preview_last_level, preview_level_size};

/// Le candidat : les deux bornes prises une fois, les trois nombres déduits d'elles.
fn preview_geometry(width: u32, height: u32) -> (u32, u32, usize) {
    let first = preview_first_level(width, height);
    let last = preview_last_level(width, height);
    let mut bytes = 0usize;
    for level in first..=last {
        let (w, h) = preview_level_size(width, height, level);
        bytes += (w as usize) * (h as usize) * 4;
    }
    (first, last - first + 1, bytes)
}

/// Copie de l'ancien `preview_pixel_bytes` : les deux bornes y étaient recalculées.
fn reference_pixel_bytes(width: u32, height: u32) -> usize {
    let mut bytes = 0usize;
    for level in preview_first_level(width, height)..=preview_last_level(width, height) {
        let (w, h) = preview_level_size(width, height, level);
        bytes += (w as usize) * (h as usize) * 4;
    }
    bytes
}

/// Copie de l'ancien trio : `preview_first_level` trois fois, `preview_last_level` deux fois.
fn reference_geometry(width: u32, height: u32) -> (u32, u32, usize) {
    (
        preview_first_level(width, height),
        preview_last_level(width, height) - preview_first_level(width, height) + 1,
        reference_pixel_bytes(width, height),
    )
}

/// Dimensions source : côtés dégénérés, limites d'un u32, tailles courantes et carrés de puissance.
fn dimensions() -> Vec<(u32, u32)> {
    let base = [
        (0u32, 0u32),
        (1, 1),
        (64, 64),
        (65, 1),
        (1, 8192),
        (4096, 2048),
        (u32::MAX, 1),
        (3, 7),
        (u32::MAX, u32::MAX),
        (2048, 2048),
    ];
    (0..4000).map(|slot| base[slot % base.len()]).collect()
}

type Trois = Vec<(u32, u32, usize)>;
fn empreinte(sortie: &Trois) -> Bits {
    let mut bits = Bits::default();
    bits.len(sortie.len());
    for (first, count, bytes) in sortie {
        bits.u32(*first);
        bits.u32(*count);
        bits.len(*bytes);
    }
    bits
}

pub(crate) fn row() -> Row {
    let tailles = dimensions();
    compare(
        "G10 géométrie d'une entrée de preview",
        "texture_preview/levels.rs, reduce.rs, manifest_binary/preview.rs",
        "4 000 entrées, dix tailles dont les limites d'un u32".into(),
        &mut || {
            tailles
                .iter()
                .map(|(w, h)| reference_geometry(*w, *h))
                .collect::<Trois>()
        },
        &mut || {
            tailles
                .iter()
                .map(|(w, h)| preview_geometry(*w, *h))
                .collect::<Trois>()
        },
        empreinte,
    )
    .ecarte(
        "mêmes nombres, aucun gain mesurable : le compilateur natif intègre et factorise déjà les \
         bornes recalculées, le candidat n'est donc pas entré dans la bibliothèque",
    )
}
