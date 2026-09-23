//! G10 — geometry of a preview entry, deduced from a single pair of bounds instead
//! of three calls that each restart from the source dimensions. The candidate is
//! written here, not in the library: it yields exactly the same numbers, but gains
//! nothing. `preview_first_level` and `preview_last_level` are small pure functions
//! that the native compiler inlines then factors itself, so the source redundancy
//! already no longer exists in the binary.
use super::harness::{compare, Bits, Row};
use crate::texture_preview::{preview_first_level, preview_last_level, preview_level_size};

/// The candidate: both bounds taken once, the three numbers deduced from them.
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

/// Copy of the old `preview_pixel_bytes`: both bounds were recomputed there.
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

/// Source dimensions: degenerate sides, u32 limits, common sizes and power-of-two squares.
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
        "G10 geometry of a preview entry",
        "texture_preview/levels.rs, reduce.rs, manifest_binary/preview.rs",
        "4 000 entries, ten sizes including the limits of a u32".into(),
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
    .spread(
        "same numbers, no measurable gain: the native compiler already inlines and factors \
         the recomputed bounds, so the candidate did not enter the library",
    )
}
