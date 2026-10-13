//! Raw ABI of the culling hierarchy builder (`culling.rs`) for the cuts the world makes at run
//! time: byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/page/codec/cullingHierarchy.ts`.
//!
//! The answer is written by `culling_build` and left in the module until `culling_build_take`
//! copies it out: the node count is known only once built.

use crate::culling::{build_culling_bvh, CullingCluster, CULLING_RECORD_FLOATS, CULLING_STRIDE};
use std::cell::RefCell;

thread_local! {
    static BUILT: RefCell<(Vec<f64>, Vec<u32>)> = const { RefCell::new((Vec::new(), Vec::new())) };
}

/// Builds the hierarchy of `count` clusters, a record of `CULLING_RECORD_FLOATS` `f64` each at
/// `records` (`CullingCluster::record`).
/// Writes the node count at `meta` and leaves the answer — the nodes, `CULLING_STRIDE` `f64` each,
/// and the cluster order, one `u32` a rank — waiting for `culling_build_take`. 0 written, 1 when a
/// level is not a whole number.
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
    let ranks: Vec<u32> = order.iter().map(|&rank| rank as u32).collect();
    debug_assert_eq!(flat.len(), nodes.len() * CULLING_STRIDE);
    BUILT.with(|held| *held.borrow_mut() = (flat, ranks));
    0
}

/// Copies the nodes `culling_build` wrote into `nodes` and the cluster order into `order`, and
/// forgets them.
///
/// # Safety
/// `nodes` and `order` must lie in live `arena_alloc` reservations of at least their lengths.
#[no_mangle]
pub unsafe extern "C" fn culling_build_take(nodes: u32, order: u32) {
    BUILT.with(|held| {
        let (flat, ranks) = held.take();
        core::slice::from_raw_parts_mut(nodes as *mut f64, flat.len()).copy_from_slice(&flat);
        core::slice::from_raw_parts_mut(order as *mut u32, ranks.len()).copy_from_slice(&ranks);
    });
}
