//! Raw ABI of the proxy builder (`proxy.rs`) for the cuts the world makes at run time: byte
//! offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/world/page/runtimeProxy.ts`.
//!
//! The columns are built by `proxy_build` and held for the loader (`held.rs`): their size is known
//! only once built.

use crate::held::hold;
use crate::proxy::{cut_columns, PROXY_NODE_WORDS, PROXY_TRIANGLE_FLOATS};

/// Words of the block `proxy_build` answers in: the triangle count, the node count, the grid step
/// as an `f32`'s bits.
pub const PROXY_META_WORDS: usize = 4;

/// Builds the proxy of the triangles `indices` (`index_count` words) draw over `positions`
/// (`vertex_count` × 3 floats), in the cut's own space. Fills `meta` (`PROXY_META_WORDS` words) and
/// holds the columns (`CutColumns::column_words`), four bytes a number, one after the other.
///
/// # Safety
/// `indices`, `positions` and `meta` must lie in live `arena_alloc` reservations of the sizes they
/// state; every index must be under `vertex_count`.
#[no_mangle]
pub unsafe extern "C" fn proxy_build(
    indices: u32,
    index_count: u32,
    positions: u32,
    vertex_count: u32,
    meta: u32,
) -> u32 {
    let indices = core::slice::from_raw_parts(indices as *const u32, index_count as usize);
    let positions = core::slice::from_raw_parts(positions as *const f32, vertex_count as usize * 3);
    let built = cut_columns(indices, positions);
    let answer = core::slice::from_raw_parts_mut(meta as *mut u32, PROXY_META_WORDS);
    answer[0] = (built.triangles.len() / PROXY_TRIANGLE_FLOATS) as u32;
    answer[1] = (built.node_children.len() / PROXY_NODE_WORDS) as u32;
    answer[2] = (built.cell as f32).to_bits();
    let columns = built.column_words();
    hold(
        columns
            .iter()
            .flatten()
            .flat_map(|word| word.to_le_bytes())
            .collect(),
    );
    0
}
