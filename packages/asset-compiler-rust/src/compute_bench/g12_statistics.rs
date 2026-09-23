//! G12 — min, median and max of a DAG level's errors, without a full sort.
//! Reference: the old `errors.sort_by(f64::total_cmp)` followed by three index reads.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::compiler_primitive_dag::level_error_stats;

fn reference_stats(errors: &mut [f64]) -> (f64, f64, f64) {
    errors.sort_by(f64::total_cmp);
    (
        errors[0],
        errors[errors.len() / 2],
        errors[errors.len() - 1],
    )
}

/// Errors of a level: duplicates, signed zeros, NaN and infinities sown in.
fn erreurs(seed: u64, count: usize) -> Vec<f64> {
    let mut rng = Xorshift::new(seed);
    let poison = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.0, 0.0];
    (0..count)
        .map(|slot| match slot % 211 {
            0 => poison[slot / 211 % poison.len()],
            7 => 1.5,
            _ => (rng.next() % 1_000_000) as f64 / 997.0,
        })
        .collect()
}

type Trois = Vec<(f64, f64, f64)>;
fn empreinte(sortie: &Trois) -> Bits {
    let mut bits = Bits::default();
    bits.len(sortie.len());
    for (min, median, max) in sortie {
        bits.f64(*min);
        bits.f64(*median);
        bits.f64(*max);
    }
    bits
}

pub(crate) fn row() -> Row {
    // Levels of a DAG: level 0 carries thousands of clusters, the next ones fewer
    // and fewer, and the last a single one. Each round restarts from a copy: sort
    // and selection both move the elements, and both sides pay the same copy.
    let niveaux: Vec<Vec<f64>> = [8000usize, 2000, 500, 120, 30, 8, 2, 1]
        .iter()
        .enumerate()
        .map(|(i, count)| erreurs(0xC12 + i as u64, *count))
        .collect();
    compare(
        "G12 error statistics of a level",
        "compiler_primitive_dag.rs",
        "8 levels, from 8 000 clusters down to one".into(),
        &mut || {
            niveaux
                .iter()
                .map(|level| reference_stats(&mut level.clone()))
                .collect::<Trois>()
        },
        &mut || {
            niveaux
                .iter()
                .map(|level| level_error_stats(&mut level.clone()))
                .collect::<Trois>()
        },
        empreinte,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `reference_stats` (the full sort from before lot G) and `level_error_stats`
    /// (the partial selection) must yield the same triplet bit for bit, on hostile
    /// levels: a single element, an even count, duplicates, and the poison (NaN,
    /// infinities, signed zeros) already sown by `erreurs`.
    fn memes_stats(valeurs: Vec<f64>, label: &str) {
        let attendu = reference_stats(&mut valeurs.clone());
        let obtenu = level_error_stats(&mut valeurs.clone());
        let identiques = attendu.0.to_bits() == obtenu.0.to_bits()
            && attendu.1.to_bits() == obtenu.1.to_bits()
            && attendu.2.to_bits() == obtenu.2.to_bits();
        assert!(identiques, "{label}: expected {attendu:?}, got {obtenu:?}");
    }

    #[test]
    fn un_seul_element_est_son_propre_minimum_median_et_maximum() {
        memes_stats(vec![42.5], "un seul element");
        memes_stats(vec![f64::NAN], "un seul element NaN");
        memes_stats(vec![-0.0], "un seul element -0.0");
    }

    #[test]
    fn two_elements_pick_the_same_upper_half_as_median() {
        memes_stats(vec![3.0, 1.0], "two decreasing elements");
        memes_stats(vec![1.0, 1.0], "two equal elements");
        memes_stats(vec![f64::INFINITY, f64::NEG_INFINITY], "two infinities");
    }

    #[test]
    fn duplicates_and_poison_do_not_diverge_the_triplet() {
        memes_stats(vec![5.0, 5.0, 5.0, 5.0, 5.0], "only duplicates");
        memes_stats(erreurs(0xA11, 7), "seven, poison included");
        memes_stats(erreurs(0xA22, 8), "eight, even, poison included");
        memes_stats(erreurs(0xA33, 211), "full poison period");
    }

    #[test]
    fn a_large_level_with_heavy_poison_remains_identical() {
        memes_stats(erreurs(0xA44, 6000), "six thousand, poison included");
    }
}
