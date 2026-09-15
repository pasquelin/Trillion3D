//! B2 — colonnes du manifeste binaire pré-dimensionnées et écrites sans `Vec<f64>` temporaire.
//! Les noms français distinguent la copie de référence du code de la bibliothèque.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::manifest_binary::format::{vector_into, Column};
use serde_json::Value;

/// Copie de l'ancienne colonne : aucune réservation, un `extend_from_slice` par valeur.
#[derive(Default)]
struct ColonneAncienne {
    octets: Vec<u8>,
}
impl ColonneAncienne {
    fn nombre(&mut self, valeur: f64) {
        self.octets.extend_from_slice(&valeur.to_le_bytes());
    }
}

/// Copie de l'ancien `number()` : le nom de la valeur arrive déjà construit.
fn nombre_ancien(valeur: Option<&Value>, quoi: &str) -> f64 {
    valeur
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("{quoi} n'est pas un nombre"))
}

/// Copie de l'ancien `vector()` : un `Vec<f64>` par sphère et par paire de bornes, et le nom de
/// chaque entrée formaté au passage, valide ou non.
fn vecteur_ancien(valeur: Option<&Value>, longueur: usize, quoi: &str) -> Vec<f64> {
    let entrees = valeur.and_then(Value::as_array).expect("tableau");
    assert_eq!(entrees.len(), longueur, "longueur du vecteur");
    entrees
        .iter()
        .enumerate()
        .map(|(i, entree)| nombre_ancien(Some(entree), &format!("{quoi}[{i}]")))
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
            bornes.nombre(*valeur);
        }
        for valeur in vecteur_ancien(page.get("sphere"), 4, "page.sphere") {
            sphere.nombre(valeur);
        }
        for valeur in vecteur_ancien(page.get("parentSphere"), 4, "page.parentSphere") {
            parente.nombre(valeur);
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
        "B2 colonnes du manifeste binaire",
        "manifest_binary/format.rs, page.rs",
        "20 000 pages, bornes + sphère + sphère parente".into(),
        &mut || reference_colonnes(&pages),
        &mut || optimise_colonnes(&pages),
        empreinte,
    )
}
