//! B2 — binary manifest columns pre-sized and written without a temporary `Vec<f64>`.
//! French names distinguish reference copy from library code.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::manifest_binary::format::{vector_into, Column};
use serde_json::Value;

/// Copy of the old column: no reservation, one `extend_from_slice` per value.
#[derive(Default)]
struct ColonneAncienne {
    octets: Vec<u8>,
}
impl ColonneAncienne {
    fn number(&mut self, valeur: f64) {
        self.octets.extend_from_slice(&valeur.to_le_bytes());
    }
}

/// Copy of the old `number()`: the value name arrives already built.
fn legacy_number(valeur: Option<&Value>, quoi: &str) -> f64 {
    valeur
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("{quoi} is not a number"))
}

/// Copy of the old `vector()`: a `Vec<f64>` per sphere and per bounds pair, and the
/// name of each entry formatted on the way, valid or not.
fn vecteur_ancien(valeur: Option<&Value>, longueur: usize, quoi: &str) -> Vec<f64> {
    let entrees = valeur.and_then(Value::as_array).expect("tableau");
    assert_eq!(entrees.len(), longueur, "vector length");
    entrees
        .iter()
        .enumerate()
        .map(|(i, entree)| legacy_number(Some(entree), &format!("{quoi}[{i}]")))
        .collect()
}

fn reference_colonnes(pages: &[Value]) -> Vec<Vec<u8>> {
    let mut bornes = ColonneAncienne::default();
    let mut sphere = ColonneAncienne::default();
    let mut parente = ColonneAncienne::default();
    for page in pages {
        let bas = vecteur_ancien(page.get("min"), 3, "page.min");
        let haut = vecteur_ancien(page.get("max"), 3, "page.max");
        for valeur in bas.iter().chain(haut.iter()) {
            bornes.number(*valeur);
        }
        for valeur in vecteur_ancien(page.get("sphere"), 4, "page.sphere") {
            sphere.number(valeur);
        }
        for valeur in vecteur_ancien(page.get("parentSphere"), 4, "page.parentSphere") {
            parente.number(valeur);
        }
    }
    vec![bornes.octets, sphere.octets, parente.octets]
}

fn optimise_colonnes(pages: &[Value]) -> Vec<Vec<u8>> {
    let mut colonnes: Vec<Column> = (0..3).map(|_| Column::default()).collect();
    for (index, par_page) in [48usize, 32, 32].into_iter().enumerate() {
        colonnes[index].reserve(pages.len() * par_page);
    }
    for page in pages {
        vector_into(page.get("min"), 3, "page.min", &mut colonnes[0]).expect("min");
        vector_into(page.get("max"), 3, "page.max", &mut colonnes[0]).expect("max");
        vector_into(page.get("sphere"), 4, "page.sphere", &mut colonnes[1]).expect("sphere");
        vector_into(
            page.get("parentSphere"),
            4,
            "page.parentSphere",
            &mut colonnes[2],
        )
        .expect("parentSphere");
    }
    colonnes.into_iter().map(|colonne| colonne.bytes).collect()
}

fn empreinte(colonnes: &Vec<Vec<u8>>) -> Bits {
    let mut bits = Bits::default();
    bits.len(colonnes.len());
    for colonne in colonnes {
        bits.bytes(colonne);
    }
    bits
}

pub(crate) fn row() -> Row {
    let pages = inputs::pages(0x2B_A11E, 20_000);
    compare(
        "B2 binary manifest columns",
        "manifest_binary/format.rs, page.rs",
        "20 000 pages, bounds + sphere + parent sphere".into(),
        &mut || reference_colonnes(&pages),
        &mut || optimise_colonnes(&pages),
        empreinte,
    )
}
