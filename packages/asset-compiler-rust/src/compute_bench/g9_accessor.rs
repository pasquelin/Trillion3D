//! G9 — accessor pre-validated by `plan_buffers` not re-validated each read. Reference:
//! same `accessor()` without validated id set, i.e. prior path.
use super::harness::{compare, Bits, Row};
use crate::compiler_accessor_create::accessor;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// glTF of `count` accessors, each on own view: scalars, VEC3 floats, VEC4
/// normalized on byte, matrices, non-zero offsets.
fn gltf(count: usize) -> (Value, Vec<u8>) {
    let formes = [
        (5126usize, "VEC3", 12usize, false),
        (5125, "SCALAR", 4, false),
        (5121, "VEC4", 4, true),
        (5123, "VEC2", 4, false),
        (5122, "VEC2", 4, true),
    ];
    let elements = 64usize;
    let mut views = Vec::with_capacity(count);
    let mut accessors = Vec::with_capacity(count);
    let mut offset = 0usize;
    for id in 0..count {
        let (component, kind, stride, normalized) = formes[id % formes.len()];
        let length = elements * stride;
        views.push(json!({"buffer":0,"byteOffset":offset,"byteLength":length,"byteStride":stride}));
        accessors.push(
            json!({"bufferView":id,"componentType":component,"type":kind,"count":elements,
              "normalized":normalized}),
        );
        offset += length;
    }
    (
        json!({ "accessors": accessors, "bufferViews": views }),
        vec![0u8; offset],
    )
}

type Lus = Vec<(usize, usize, usize, usize, usize, usize, bool, bool)>;
fn empreinte(lus: &Lus) -> Bits {
    let mut bits = Bits::default();
    bits.len(lus.len());
    for (base, stride, count, component, bytes, width, normalized, view) in lus {
        for value in [base, stride, count, component, bytes, width] {
            bits.len(*value);
        }
        bits.flag(*normalized);
        bits.flag(*view);
    }
    bits
}

/// Seven reads primitive makes: POSITION, indices, five named attributes.
const LECTURES: usize = 7;

fn lis(g: &Value, bin: &[u8], count: usize, validated: Option<&BTreeSet<usize>>) -> Lus {
    let mut out = Vec::with_capacity(count * LECTURES);
    for id in 0..count {
        for _ in 0..LECTURES {
            let a = accessor(g, bin, id, validated).expect("accessor valide");
            out.push((
                a.base,
                a.stride,
                a.count,
                a.component,
                a.bytes,
                a.width,
                a.normalized,
                a.has_buffer_view,
            ));
        }
    }
    out
}

pub(crate) fn row() -> Row {
    let count = 400;
    let (g, bin) = gltf(count);
    let validated: BTreeSet<usize> = (0..count).collect();
    compare(
        "G9 accessor validation done once",
        "compiler_plan.rs, compiler_accessor_create.rs, compiler_primitive.rs",
        format!("{count} accessors, {LECTURES} reads each"),
        &mut || lis(&g, &bin, count, None),
        &mut || lis(&g, &bin, count, Some(&validated)),
        empreinte,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each accessor read with `None` (old path, validated) must yield exact same
    /// seven fields as read with `Some(&validated)` when id present: skipped validation
    /// pure function of same `g`/`bin`/`id`, verdict never changes result.
    #[test]
    fn already_marked_valid_accessor_yields_same_fields_without_revalidating() {
        let count = 9; // covers five gltf() forms at least once each, plus remainder.
        let (g, bin) = gltf(count);
        let validated: BTreeSet<usize> = (0..count).collect();
        for id in 0..count {
            let sans_ensemble = accessor(&g, &bin, id, None).expect("valid without set");
            let avec_ensemble =
                accessor(&g, &bin, id, Some(&validated)).expect("valid, already marked");
            assert_eq!(
                (
                    sans_ensemble.base,
                    sans_ensemble.stride,
                    sans_ensemble.count,
                    sans_ensemble.component,
                    sans_ensemble.bytes,
                    sans_ensemble.width,
                    sans_ensemble.normalized,
                    sans_ensemble.has_buffer_view,
                ),
                (
                    avec_ensemble.base,
                    avec_ensemble.stride,
                    avec_ensemble.count,
                    avec_ensemble.component,
                    avec_ensemble.bytes,
                    avec_ensemble.width,
                    avec_ensemble.normalized,
                    avec_ensemble.has_buffer_view,
                ),
                "id {id}"
            );
        }
    }

    #[test]
    fn a_partial_or_empty_valid_set_changes_nothing_for_absent_ids() {
        let count = 5;
        let (g, bin) = gltf(count);
        // Empty: no one marked validated, behavior identical to `None`.
        let vide: BTreeSet<usize> = BTreeSet::new();
        // Partial: only even ids marked.
        let partiel: BTreeSet<usize> = (0..count).filter(|id| id % 2 == 0).collect();
        for id in 0..count {
            let reference = accessor(&g, &bin, id, None).expect("reference");
            let sans_marque = accessor(&g, &bin, id, Some(&vide)).expect("ensemble vide");
            assert_eq!(reference.base, sans_marque.base, "id {id}, ensemble vide");
            let via_partiel = accessor(&g, &bin, id, Some(&partiel)).expect("ensemble partiel");
            assert_eq!(
                reference.base, via_partiel.base,
                "id {id}, ensemble partiel"
            );
            assert_eq!(
                reference.count, via_partiel.count,
                "id {id}, ensemble partiel"
            );
        }
    }

    #[test]
    fn an_out_of_range_id_fails_alike_marked_absent_or_set_absent() {
        let count = 3;
        let (g, bin) = gltf(count);
        let hors_limites = count + 5;
        let message_de = |resultat: Result<_, crate::CompilerError>| match resultat {
            Err(e) => e.to_string(),
            Ok(_) => panic!("out-of-range id should have failed"),
        };
        let sans_ensemble = message_de(accessor(&g, &bin, hors_limites, None));
        let ensemble_ne_le_contenant_pas: BTreeSet<usize> = (0..count).collect();
        let avec_ensemble = message_de(accessor(
            &g,
            &bin,
            hors_limites,
            Some(&ensemble_ne_le_contenant_pas),
        ));
        assert_eq!(sans_ensemble, avec_ensemble);
    }

    #[test]
    fn the_seven_reads_of_a_primitive_stay_identical_on_every_shape() {
        let count = 400;
        let (g, bin) = gltf(count);
        let validated: BTreeSet<usize> = (0..count).collect();
        assert_eq!(
            lis(&g, &bin, count, None),
            lis(&g, &bin, count, Some(&validated))
        );
    }
}
