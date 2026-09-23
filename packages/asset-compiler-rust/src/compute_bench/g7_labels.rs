//! G7 — the error label of a manifest column, built only when there is an error.
//! Reference: the old loop, which formatted a `String` per valid culling node.
//! Literal labels in `primitive.rs` (group members) and `page.rs` (`page.*` and
//! `page.geometry.*` keys) follow the same pattern, with no possible allocation:
//! they are not measured.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::manifest_binary::format::{numbers_into, Column};
use crate::{CompilerError, Result};
use serde_json::{json, Value};

/// Copy of the old `number()`: the value name arrives already built.
fn legacy_number(valeur: Option<&Value>, quoi: &str) -> Result<f64> {
    valeur
        .and_then(Value::as_f64)
        .ok_or_else(|| CompilerError::new("INVALID_MANIFEST", format!("{quoi} is not a number")))
}

/// Copy of the old loop: a formatted string at each node, valid or not.
fn reference_nodes(nodes: &[Value], column: &mut Column) -> Result<()> {
    for (i, node) in nodes.iter().enumerate() {
        column.f64(legacy_number(
            Some(node),
            &format!("primitive.culling.nodes[{i}]"),
        )?);
    }
    Ok(())
}

/// Flat numbers of a culling hierarchy, and a set whose ninth entry is not one.
fn nodes(seed: u64, count: usize) -> (Vec<Value>, Vec<Value>) {
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
        fautifs[9] = json!("not a number");
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
    let (sains, fautifs) = nodes(0x6117, 20_000 * crate::CULLING_STRIDE);
    let taille = format!("{} culling nodes, plus a faulty set", sains.len());
    compare(
        "G7 labels of the manifest columns",
        "manifest_binary/primitive.rs, page.rs",
        taille,
        &mut || {
            let mut column = Column::default();
            reference_nodes(&sains, &mut column).expect("healthy nodes");
            let mut rate = Column::default();
            let message = reference_nodes(&fautifs, &mut rate)
                .expect_err("faulty node")
                .to_string();
            (column.bytes, message)
        },
        &mut || {
            let mut column = Column::default();
            numbers_into(&sains, "primitive.culling.nodes", &mut column).expect("healthy nodes");
            let mut rate = Column::default();
            let message = numbers_into(&fautifs, "primitive.culling.nodes", &mut rate)
                .expect_err("faulty node")
                .to_string();
            (column.bytes, message)
        },
        empreinte,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `reference_nodes` (a formatted string per valid node, the old path) and
    /// `numbers_into` (the label exists only in the error branch) must write the
    /// same bytes on a healthy set, and yield the same message on a faulty set —
    /// whatever the position of the faulty node in the array.
    fn same_bytes_and_message(sains: &[Value], fautifs: &[Value], label: &str) {
        let mut colonne_ref = Column::default();
        reference_nodes(sains, &mut colonne_ref).expect("healthy nodes, reference");
        let mut colonne_neuve = Column::default();
        numbers_into(sains, "primitive.culling.nodes", &mut colonne_neuve)
            .expect("healthy nodes, new version");
        assert_eq!(colonne_ref.bytes, colonne_neuve.bytes, "{label}: bytes");

        if fautifs.is_empty() {
            return;
        }
        let mut poubelle = Column::default();
        let message_ref = reference_nodes(fautifs, &mut poubelle)
            .expect_err("faulty set, reference")
            .to_string();
        let mut poubelle2 = Column::default();
        let message_neuf = numbers_into(fautifs, "primitive.culling.nodes", &mut poubelle2)
            .expect_err("faulty set, new version")
            .to_string();
        assert_eq!(message_ref, message_neuf, "{label}: error message");
    }

    #[test]
    fn an_empty_array_produces_no_byte_and_no_error() {
        same_bytes_and_message(&[], &[], "empty array");
    }

    #[test]
    fn a_single_node_valid_or_faulty() {
        same_bytes_and_message(&[json!(3.5)], &[], "single valid node");
        same_bytes_and_message(&[], &[json!("not a number")], "single faulty node");
    }

    #[test]
    fn the_faulty_node_at_head_middle_or_tail_gives_the_same_message() {
        let tete = vec![json!("x"), json!(1.0), json!(2.0)];
        same_bytes_and_message(&[], &tete, "faulty at head");
        let milieu = vec![json!(1.0), json!("x"), json!(2.0)];
        same_bytes_and_message(&[], &milieu, "faulty in middle");
        let queue = vec![json!(1.0), json!(2.0), json!("x")];
        same_bytes_and_message(&[], &queue, "faulty at tail");
    }

    #[test]
    fn float_poison_without_error_writes_the_same_bytes() {
        let sains = vec![
            json!(-0.0),
            json!(f64::MAX),
            json!(5e-324),
            json!(0.0),
            json!(1.0 / 3.0),
        ];
        same_bytes_and_message(&sains, &[], "floating poison");
    }

    #[test]
    fn a_large_sound_set_then_the_same_with_one_faulty_entry() {
        let (sains, fautifs) = nodes(0x707, 5_000);
        same_bytes_and_message(&sains, &fautifs, "large set, nineteenth failed");
    }
}
