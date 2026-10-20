//! Raw ABI of the triangle clusterer (`../clusters.rs`) for the cuts the world makes at run time:
//! byte offsets into `arena_alloc` reservations, like `encode.rs`. The loader is
//! `packages/sdk-browser/src/geometry/codec/clusterTriangles.ts`.
//!
//! The answer is built by `cluster_build` and held for the loader (`held.rs`): the cluster count is
//! known only once built.

use crate::clusters::{cluster, Caps, Clustered};
use crate::wasm::held::hold;
use crate::wasm::math::view;

/// `cluster_build`'s order word for clusters free to reorder the triangles (`../clusters.rs`).
pub const CLUSTER_SPATIAL: u32 = 0;
/// `cluster_build`'s order word for clusters held to the source order (`../clusters.rs`).
pub const CLUSTER_ORDERED: u32 = 1;

/// Clusters the triangles `indices` (`index_count` words) draw over `positions` (`vertex_count`
/// × 3 floats), held to their order when `rule` is `CLUSTER_ORDERED`, each within `max_triangles` and `max_vertices`. Writes the cluster count
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
    let indices = view(indices, index_count as usize);
    let positions = view(positions, vertex_count as usize * 3);
    let caps: &[u32] = view(caps, 2);
    let caps = Caps {
        triangles: caps[0] as usize,
        vertices: caps[1] as usize,
    };
    let keep_order = match rule {
        CLUSTER_SPATIAL => false,
        CLUSTER_ORDERED => true,
        _ => return 1,
    };
    let Clustered {
        indices: order,
        ends,
    } = cluster(positions, indices, caps, keep_order);
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
