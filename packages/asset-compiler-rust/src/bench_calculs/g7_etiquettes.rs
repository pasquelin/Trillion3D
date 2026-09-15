//! G7 — l'étiquette d'erreur d'une colonne du manifeste, construite seulement lorsqu'il y a une
//! erreur. Référence : l'ancienne boucle, qui formatait une `String` par nœud de culling valide.
//! Les étiquettes littérales de `primitive.rs` (membres de groupe) et de `page.rs` (clés `page.*` et
//! `page.geometry.*`) relèvent du même motif, sans allocation possible : elles ne sont pas mesurées.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::manifest_binary::format::{numbers_into, Column};
use crate::{CompilerError, Result};
use serde_json::{json, Value};

/// Copie de l'ancien `number()` : le nom de la valeur arrive déjà construit.
fn nombre_ancien(valeur: Option<&Value>, quoi: &str) -> Result<f64> {
    valeur
        .and_then(Value::as_f64)
        .ok_or_else(|| CompilerError::new("INVALID_MANIFEST", format!("{quoi} is not a number")))
}

/// Copie de l'ancienne boucle : une chaîne formatée à chaque nœud, valide ou non.
fn reference_nodes(nodes: &[Value], column: &mut Column) -> Result<()> {
    for (i, node) in nodes.iter().enumerate() {
        column.f64(nombre_ancien(
            Some(node),
            &format!("primitive.culling.nodes[{i}]"),
        )?);
    }
    Ok(())
}

/// Les nombres plats d'une hiérarchie de culling, et un jeu dont la neuvième entrée n'en est pas un.
fn noeuds(seed: u64, count: usize) -> (Vec<Value>, Vec<Value>) {
    let mut rng = Xorshift::new(seed);
    let mut sains = Vec::with_capacity(count);
    for slot in 0..count {
        sains.push(match slot % 97 {
            0 => json!(-0.0),
            13 => json!(f64::MAX),
            41 => json!(5e-324),
            _ => json!((rng.next() % 1_000_000) as f64 / 997.0),
        });
    }
    let mut fautifs = sains[..16.min(count)].to_vec();
    if fautifs.len() > 9 {
        fautifs[9] = json!("pas un nombre");
    }
    (sains, fautifs)
}

type Sortie = (Vec<u8>, String);
fn empreinte(sortie: &Sortie) -> Bits {
    let mut bits = Bits::default();
    bits.bytes(&sortie.0);
    bits.text(&sortie.1);
    bits
}

pub(crate) fn row() -> Row {
    let (sains, fautifs) = noeuds(0x6117, 20_000 * crate::CULLING_STRIDE);
    let taille = format!("{} nœuds de culling, plus un jeu fautif", sains.len());
    compare(
        "G7 étiquettes des colonnes du manifeste",
        "manifest_binary/primitive.rs, page.rs",
        taille,
        &mut || {
            let mut column = Column::default();
            reference_nodes(&sains, &mut column).expect("nœuds sains");
            let mut rate = Column::default();
            let message = reference_nodes(&fautifs, &mut rate)
                .expect_err("nœud fautif")
                .to_string();
            (column.bytes, message)
        },
        &mut || {
            let mut column = Column::default();
            numbers_into(&sains, "primitive.culling.nodes", &mut column).expect("nœuds sains");
            let mut rate = Column::default();
            let message = numbers_into(&fautifs, "primitive.culling.nodes", &mut rate)
                .expect_err("nœud fautif")
                .to_string();
            (column.bytes, message)
        },
        empreinte,
    )
}
