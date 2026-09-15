//! G9 — l'accessor déjà validé par `plan_buffers` n'est plus revalidé à chaque lecture. Référence :
//! le même `accessor()` sans l'ensemble des identifiants validés, c'est-à-dire le chemin d'avant.
use super::harness::{compare, Bits, Row};
use crate::compiler_accessor_create::accessor;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// Un glTF de `count` accessors, chacun sur sa propre vue : scalaires, VEC3 flottants, VEC4
/// normalisés sur un octet, matrices, et des décalages non nuls.
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

/// Les sept lectures qu'une primitive fait : POSITION, les indices, puis cinq attributs nommés.
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
        "G9 validation d'accessor faite une seule fois",
        "compiler_plan.rs, compiler_accessor_create.rs, compiler_primitive.rs",
        format!("{count} accessors, {LECTURES} lectures chacun"),
        &mut || lis(&g, &bin, count, None),
        &mut || lis(&g, &bin, count, Some(&validated)),
        empreinte,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chaque accessor lu avec `None` (l'ancien chemin, toujours validé) doit rendre exactement les
    /// mêmes sept champs que lu avec `Some(&validated)` quand son id y figure : la validation sautée
    /// est une fonction pure des mêmes `g`/`bin`/`id`, son verdict ne change jamais le résultat.
    #[test]
    fn accessor_valide_deja_marque_rend_les_memes_champs_sans_revalider() {
        let count = 9; // couvre les cinq formes de `gltf()` au moins une fois chacune, plus reste.
        let (g, bin) = gltf(count);
        let validated: BTreeSet<usize> = (0..count).collect();
        for id in 0..count {
            let sans_ensemble = accessor(&g, &bin, id, None).expect("valide sans ensemble");
            let avec_ensemble =
                accessor(&g, &bin, id, Some(&validated)).expect("valide, deja marque");
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
    fn un_ensemble_valide_partiel_ou_vide_ne_change_rien_pour_les_ids_absents() {
        let count = 5;
        let (g, bin) = gltf(count);
        // Vide : personne n'est marqué déjà validé, comportement identique à `None`.
        let vide: BTreeSet<usize> = BTreeSet::new();
        // Partiel : seuls les ids pairs sont marqués.
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
    fn un_id_hors_limites_echoue_pareillement_marque_absent_ou_ensemble_absent() {
        let count = 3;
        let (g, bin) = gltf(count);
        let hors_limites = count + 5;
        let message_de = |resultat: Result<_, crate::CompilerError>| match resultat {
            Err(e) => e.to_string(),
            Ok(_) => panic!("id hors limites aurait dû échouer"),
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
    fn les_sept_lectures_dune_primitive_restent_identiques_sur_toutes_les_formes() {
        let count = 400;
        let (g, bin) = gltf(count);
        let validated: BTreeSet<usize> = (0..count).collect();
        assert_eq!(
            lis(&g, &bin, count, None),
            lis(&g, &bin, count, Some(&validated))
        );
    }
}
