//! G12 — le minimum, la médiane et le maximum des erreurs d'un niveau du DAG, sans tri complet.
//! Référence : l'ancien `errors.sort_by(f64::total_cmp)` suivi de trois lectures d'indice.
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

/// Les erreurs d'un niveau : doublons, zéros signés, NaN et infinis semés dedans.
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
    // Les niveaux d'un DAG : le niveau 0 porte des milliers de clusters, les suivants de moins en
    // moins, et le dernier un seul. Chaque tour repart d'une copie : le tri comme la sélection
    // déplacent les éléments, et les deux côtés paient la même copie.
    let niveaux: Vec<Vec<f64>> = [8000usize, 2000, 500, 120, 30, 8, 2, 1]
        .iter()
        .enumerate()
        .map(|(i, count)| erreurs(0xC12 + i as u64, *count))
        .collect();
    compare(
        "G12 statistiques d'erreur d'un niveau",
        "compiler_primitive_dag.rs",
        "8 niveaux, de 8 000 clusters à un seul".into(),
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

    /// `reference_stats` (le tri complet d'avant le lot G) et `level_error_stats` (la sélection
    /// partielle) doivent rendre le même triplet bit à bit, sur des niveaux hostiles : un seul
    /// élément, un nombre pair, des doublons, et le poison (NaN, infinis, zéros signés) déjà semé
    /// par `erreurs`.
    fn memes_stats(valeurs: Vec<f64>, label: &str) {
        let attendu = reference_stats(&mut valeurs.clone());
        let obtenu = level_error_stats(&mut valeurs.clone());
        let identiques = attendu.0.to_bits() == obtenu.0.to_bits()
            && attendu.1.to_bits() == obtenu.1.to_bits()
            && attendu.2.to_bits() == obtenu.2.to_bits();
        assert!(
            identiques,
            "{label}: attendu {attendu:?}, obtenu {obtenu:?}"
        );
    }

    #[test]
    fn un_seul_element_est_son_propre_minimum_median_et_maximum() {
        memes_stats(vec![42.5], "un seul element");
        memes_stats(vec![f64::NAN], "un seul element NaN");
        memes_stats(vec![-0.0], "un seul element -0.0");
    }

    #[test]
    fn deux_elements_choisissent_la_meme_moitie_haute_comme_mediane() {
        memes_stats(vec![3.0, 1.0], "deux elements decroissants");
        memes_stats(vec![1.0, 1.0], "deux elements egaux");
        memes_stats(vec![f64::INFINITY, f64::NEG_INFINITY], "deux infinis");
    }

    #[test]
    fn des_doublons_et_le_poison_ne_font_pas_diverger_le_triplet() {
        memes_stats(vec![5.0, 5.0, 5.0, 5.0, 5.0], "que des doublons");
        memes_stats(erreurs(0xA11, 7), "sept, poison inclus");
        memes_stats(erreurs(0xA22, 8), "huit, pair, poison inclus");
        memes_stats(erreurs(0xA33, 211), "une periode complete de poison");
    }

    #[test]
    fn un_grand_niveau_avec_beaucoup_de_poison_reste_identique() {
        memes_stats(erreurs(0xA44, 6000), "six mille, poison inclus");
    }
}
