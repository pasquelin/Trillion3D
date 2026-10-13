//! Raw ABI of the triangle clusterer (`clusters.rs`) for the cuts the world makes at run time:
//! byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/page/codec/clusterTriangles.ts`.
//!
//! The answer is written by `cluster_build` and left in the module until `cluster_build_take`
//! copies it out: the cluster count is known only once built.

use crate::clusters::{ordered::ordered, spatial::spatial, Caps};
use std::cell::RefCell;

/// The rule `cluster_build` takes: the spatial one, the ordered one, the ordered one with its runs
/// held compact.
pub const CLUSTER_SPATIAL: u32 = 0;
pub const CLUSTER_ORDERED: u32 = 1;
pub const CLUSTER_ORDERED_COMPACT: u32 = 2;

thread_local! {
    static BUILT: RefCell<(Vec<u32>, Vec<u32>)> = const { RefCell::new((Vec::new(), Vec::new())) };
}

/// Clusters the triangles `indices` (`index_count` words) draw over `positions` (`vertex_count`
/// × 3 floats) by `rule`, each within `max_triangles` and `max_vertices`. Writes the cluster count
/// at `meta` and leaves the answer — the indices in cluster order, and where each cluster ends —
/// waiting for `cluster_build_take`. 0 written, 1 for a rule it does not know.
///
/// # Safety
/// `indices`, `positions` and `meta` must lie in live `arena_alloc` reservations of the sizes they
/// state.
#[no_mangle]
pub unsafe extern "C" fn cluster_build(
    indices: u32,
    index_count: u32,
    positions: u32,
    vertex_count: u32,
    rule: u32,
    caps: u32,
    meta: u32,
) -> u32 {
    let indices = core::slice::from_raw_parts(indices as *const u32, index_count as usize);
    let positions = core::slice::from_raw_parts(positions as *const f32, vertex_count as usize * 3);
    let caps = core::slice::from_raw_parts(caps as *const u32, 2);
    let caps = Caps {
        triangles: caps[0] as usize,
        vertices: caps[1] as usize,
    };
    let (order, ends) = match rule {
        CLUSTER_SPATIAL => {
            let built = spatial(positions, indices, caps);
            (built.indices, built.ends)
        }
        CLUSTER_ORDERED | CLUSTER_ORDERED_COMPACT => {
            let compact = (rule == CLUSTER_ORDERED_COMPACT).then_some(positions);
            let ranges = ordered(indices, vertex_count as usize, compact, caps);
            (indices.to_vec(), ranges.iter().map(|r| r[1]).collect())
        }
        _ => return 1,
    };
    *(meta as *mut u32) = ends.len() as u32;
    let ends = ends.iter().map(|&end| end as u32).collect();
    BUILT.with(|held| *held.borrow_mut() = (order, ends));
    0
}

/// Copies the indices `cluster_build` ordered into `indices` and the clusters' ends into `ends`,
/// and forgets them.
///
/// # Safety
/// `indices` and `ends` must lie in live `arena_alloc` reservations of at least their lengths.
#[no_mangle]
pub unsafe extern "C" fn cluster_build_take(indices: u32, ends: u32) {
    BUILT.with(|held| {
        let (order, built) = held.take();
        core::slice::from_raw_parts_mut(indices as *mut u32, order.len()).copy_from_slice(&order);
        core::slice::from_raw_parts_mut(ends as *mut u32, built.len()).copy_from_slice(&built);
    });
}
