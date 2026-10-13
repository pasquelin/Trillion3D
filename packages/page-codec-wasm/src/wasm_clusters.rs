//! Raw ABI of the triangle clusterer (`clusters.rs`) for the cuts the world makes at run time:
//! byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/page/codec/clusterTriangles.ts`.
//!
//! The answer is built by `cluster_build` and held for the loader (`held.rs`): the cluster count is
//! known only once built.

use crate::clusters::{ordered::ordered, spatial::spatial, Caps};
use crate::held::hold;

/// The rule `cluster_build` takes: the spatial one, the ordered one, the ordered one with its runs
/// held compact.
pub const CLUSTER_SPATIAL: u32 = 0;
pub const CLUSTER_ORDERED: u32 = 1;
pub const CLUSTER_ORDERED_COMPACT: u32 = 2;

/// Clusters the triangles `indices` (`index_count` words) draw over `positions` (`vertex_count`
/// × 3 floats) by `rule`, each within `max_triangles` and `max_vertices`. Writes the cluster count
/// at `meta` and holds the answer, four bytes a word: the indices in cluster order, then where each
/// cluster ends. 0 written, 1 for a rule it does not know.
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
    let ends = ends.iter().map(|&end| end as u32);
    hold(
        order
            .into_iter()
            .chain(ends)
            .flat_map(u32::to_le_bytes)
            .collect(),
    );
    0
}
