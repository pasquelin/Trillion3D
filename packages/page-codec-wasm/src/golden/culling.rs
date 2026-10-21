//! The culling hierarchy builder (`culling.rs`), the compiler's and the run-time cut's: the nodes
//! the native build writes for generated families, which the SDK module must write bit for bit
//! (`wasm/culling.rs`, `sdk-browser/src/geometry/codec/cullingHierarchy.golden.test.ts`).

use crate::culling::families::families;
use crate::culling::{build_culling_bvh, CullingPart, CULLING_RECORD_FLOATS};
use trillion3d_math::golden::{Twin, Value};

pub(crate) fn twins() -> [Twin; 1] {
    [Twin {
        file: "culling",
        name: "build_culling_bvh",
        about: "the culling hierarchy of group parts given as records (box, LOD sphere, least own error, replacement error, level, first rank, count): the node count, then every node in the manifest's 16-number layout (page-codec-wasm culling.rs build_culling_bvh, run by the SDK module, wasm_culling.rs)",
        inputs: "count: u32, then per part 15 f64: min, max, LOD sphere, least own error, parent error (inf for a root), level, first rank, count",
        outputs: "nodes: u32, nodes x 16 f64",
        ulps: 0,
        cases,
        compute,
    }]
}

fn cases() -> Vec<Vec<Value>> {
    families([6, 5, 60, 20, 12])
        .iter()
        .map(|parts| {
            let mut values = vec![Value::U32(parts.len() as u32)];
            for part in parts {
                values.extend(part.record().map(Value::F64));
            }
            values
        })
        .collect()
}

fn compute(v: &[Value]) -> Vec<Value> {
    let records: Vec<f64> = v[1..].iter().map(|value| value.f64()).collect();
    let parts: Vec<CullingPart> = records
        .as_chunks::<CULLING_RECORD_FLOATS>()
        .0
        .iter()
        .map(|r| CullingPart::from_record(r).expect("whole numbers"))
        .collect();
    let nodes = build_culling_bvh(&parts);
    let mut out = vec![Value::U32(nodes.len() as u32)];
    out.extend(nodes.iter().flat_map(|node| node.flat()).map(Value::F64));
    out
}
