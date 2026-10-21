//! Raw ABI of the culling hierarchy builder (`../culling.rs`) for the cuts the world makes at run
//! time: byte offsets into `arena_alloc` reservations, like `encode.rs`. The loader is
//! `packages/sdk-browser/src/geometry/codec/cullingHierarchy.ts`.
//!
//! The answer is built by `culling_build` and held for the loader (`held.rs`): the node count is
//! known only once built.

use crate::culling::{build_culling_bvh, CullingPart, CULLING_RECORD_FLOATS, CULLING_STRIDE};
use crate::wasm::held::hold;
use crate::wasm::math::view;

/// Builds the hierarchy of `count` parts, a record of `CULLING_RECORD_FLOATS` `f64` each at
/// `records` (`CullingPart::record`).
/// Writes the node count at `meta` and holds the answer: the nodes, `CULLING_STRIDE` `f64` each.
/// 0 written, 1 when a level, a first rank or a count is not a whole number.
///
/// # Safety
/// `records` and `meta` must lie in live `arena_alloc` reservations of the sizes they state.
#[no_mangle]
pub unsafe extern "C" fn culling_build(records: u32, count: u32, meta: u32) -> u32 {
    let records: &[f64] = view(records, count as usize * CULLING_RECORD_FLOATS);
    let parts: Option<Vec<CullingPart>> = records
        .chunks_exact(CULLING_RECORD_FLOATS)
        .map(CullingPart::from_record)
        .collect();
    let Some(parts) = parts else {
        return 1;
    };
    let nodes = build_culling_bvh(&parts);
    *(meta as *mut u32) = nodes.len() as u32;
    let flat: Vec<f64> = nodes.iter().flat_map(|node| node.flat()).collect();
    debug_assert_eq!(flat.len(), nodes.len() * CULLING_STRIDE);
    hold(flat.iter().flat_map(|v| v.to_le_bytes()).collect());
    0
}
