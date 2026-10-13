//! Raw ABI of the culling hierarchy builder (`culling.rs`) for the cuts the world makes at run
//! time: byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/page/codec/cullingHierarchy.ts`.
//!
//! The answer is built by `culling_build` and held for the loader (`held.rs`): the node count is
//! known only once built.

use crate::culling::{build_culling_bvh, CullingCluster, CULLING_RECORD_FLOATS, CULLING_STRIDE};
use crate::held::hold;

/// Builds the hierarchy of `count` clusters, a record of `CULLING_RECORD_FLOATS` `f64` each at
/// `records` (`CullingCluster::record`).
/// Writes the node count at `meta` and holds the answer: the nodes, `CULLING_STRIDE` `f64` each,
/// then the cluster order, one `u32` a rank. 0 written, 1 when a level is not a whole number.
///
/// # Safety
/// `records` and `meta` must lie in live `arena_alloc` reservations of the sizes they state.
#[no_mangle]
pub unsafe extern "C" fn culling_build(records: u32, count: u32, meta: u32) -> u32 {
    let records = core::slice::from_raw_parts(
        records as *const f64,
        count as usize * CULLING_RECORD_FLOATS,
    );
    let clusters: Option<Vec<CullingCluster>> = records
        .chunks_exact(CULLING_RECORD_FLOATS)
        .map(CullingCluster::from_record)
        .collect();
    let Some(clusters) = clusters else {
        return 1;
    };
    let (order, nodes) = build_culling_bvh(&clusters);
    *(meta as *mut u32) = nodes.len() as u32;
    let flat: Vec<f64> = nodes.iter().flat_map(|node| node.flat()).collect();
    debug_assert_eq!(flat.len(), nodes.len() * CULLING_STRIDE);
    let ranks = order.iter().flat_map(|&rank| (rank as u32).to_le_bytes());
    hold(
        flat.iter()
            .flat_map(|v| v.to_le_bytes())
            .chain(ranks)
            .collect(),
    );
    0
}
