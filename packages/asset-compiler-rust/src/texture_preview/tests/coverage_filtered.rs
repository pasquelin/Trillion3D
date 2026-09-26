use super::*;
use crate::texture_preview::coverage::filtered_covered;

/// Filtered samples of a square `level` (RGBA8) at or above `cutoff`, four a texel.
fn covered(level: &[u8], cutoff: u8) -> u64 {
    filtered_covered(level, ((level.len() / 4) as f64).sqrt() as usize, cutoff)
}

/// Levels of square `chain` whose filtered samples at or above `cutoff` stray from level 0's
/// share by more than 2.5 %, or by more than one texel's four where 2.5 % is less: a level cannot
/// cover a fraction of a texel.
pub(super) fn strays(chain: &[Vec<u8>], cutoff: u8) -> Vec<usize> {
    let share = covered(&chain[0], cutoff) as f64 / chain[0].len() as f64;
    (0..chain.len())
        .filter(|&k| {
            let target = share * chain[k].len() as f64;
            (covered(&chain[k], cutoff) as f64 - target).abs() > (0.025 * target).max(4.0)
        })
        .collect()
}

// #43: coverage is counted on the bilinearly filtered cut, not on the texels. On this noise the
// two disagree — a chain holding the texel counts strays at 8² —, and the compiler's filtered
// counts are the table every builder of the card stays within 2.5 % of (`leafCoverage.test.ts`).
#[test]
fn coverage_holds_on_the_filtered_cut() {
    let table: Value = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/formats/previews/coverage-filtered.json"
    ))
    .expect("table");
    let side = table["side"].as_u64().expect("side") as u32;
    let alpha: Vec<u8> = table["alpha"]
        .as_array()
        .expect("rows")
        .iter()
        .flat_map(|row| {
            row.as_str()
                .expect("row")
                .split_whitespace()
                .map(|a| a.parse().expect("byte"))
        })
        .collect();
    let cutoff = table["cutoff"].as_u64().expect("cutoff") as u8;
    let source = rgba_from(side, side, |x, y| [9, 9, 9, alpha[(y * side + x) as usize]]);
    let chain = reduce::chain(&source, AtlasKind::Coverage(cutoff));
    assert_eq!(strays(&chain, cutoff), [0usize; 0]);
    let counts: Vec<u64> = chain.iter().map(|level| covered(level, cutoff)).collect();
    let expected: Vec<u64> = serde_json::from_value(table["covered"].clone()).expect("covered");
    assert_eq!(counts, expected[..counts.len()]);
}
