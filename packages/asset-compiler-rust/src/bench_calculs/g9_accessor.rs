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
