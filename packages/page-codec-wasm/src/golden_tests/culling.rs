//! The culling hierarchy builder (`culling.rs`), the compiler's and the run-time cut's: the nodes
//! and the cluster order the native build writes for generated families, which the SDK module
//! must write bit for bit (`wasm_culling.rs`, `sdk-browser/src/page/codec/cullingHierarchy.golden.test.ts`).

use crate::culling::families::families;
use crate::culling::{build_culling_bvh, CullingCluster, CULLING_RECORD_FLOATS};
use trillion3d_math::golden::{Twin, Value};

pub(crate) fn twins() -> [Twin; 1] {
    [Twin {
        file: "culling",
        name: "build_culling_bvh",
        about: "the culling hierarchy of clusters given as records (box, replacement sphere, replacement error, level): the node count, every node in the manifest's 15-number layout, then the cluster order (page-codec-wasm culling.rs build_culling_bvh, run by the SDK module, wasm_culling.rs)",
        inputs: "count: u32, then per cluster 12 f64: min, max, parent sphere, parent error (inf for a root), level",
        outputs: "nodes: u32, nodes x 15 f64, count u32",
        cases,
        compute,
    }]
}

fn cases() -> Vec<Vec<Value>> {
    families([6, 5, 60, 20, 12])
        .iter()
        .map(|clusters| {
            let mut values = vec![Value::U32(clusters.len() as u32)];
            for cluster in clusters {
                values.extend(cluster.record().map(Value::F64));
            }
            values
        })
        .collect()
}

fn compute(v: &[Value]) -> Vec<Value> {
    let records: Vec<f64> = v[1..].iter().map(|value| value.f64()).collect();
    let clusters: Vec<CullingCluster> = records
        .as_chunks::<CULLING_RECORD_FLOATS>()
        .0
        .iter()
        .map(|r| CullingCluster::from_record(r).expect("a whole level"))
        .collect();
    let (order, nodes) = build_culling_bvh(&clusters);
    let mut out = vec![Value::U32(nodes.len() as u32)];
    out.extend(nodes.iter().flat_map(|node| node.flat()).map(Value::F64));
    out.extend(order.iter().map(|&rank| Value::U32(rank as u32)));
    out
}
