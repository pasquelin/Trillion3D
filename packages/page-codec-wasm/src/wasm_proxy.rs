//! Raw ABI of the proxy builder (`proxy.rs`) for the cuts the world makes at run time: byte
//! offsets into `arena_alloc` reservations, like `wasm_encode.rs`. The loader is
//! `packages/sdk-browser/src/world/page/runtimeProxy.ts`.
//!
//! The columns are written by `proxy_build` and left in the module until `proxy_build_take` copies
//! them out: their size is known only once built.

use crate::proxy::cut_columns;
use std::cell::RefCell;

/// Words of the block `proxy_build` answers in: the triangle count, the node count, the grid step
/// as an `f32`'s bits.
pub const PROXY_META_WORDS: usize = 4;

thread_local! {
    static COLUMNS: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Builds the proxy of the triangles `indices` (`index_count` words) draw over `positions`
/// (`vertex_count` × 3 floats), in the cut's own space. Fills `meta` (`PROXY_META_WORDS` words) and
/// leaves the columns — triangles, albedo, node bounds, node children, sources, four bytes a number — waiting
/// for `proxy_build_take`.
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
    answer[0] = (built.triangles.len() / crate::proxy::PROXY_TRIANGLE_FLOATS) as u32;
    answer[1] = (built.node_children.len() / crate::proxy::PROXY_NODE_WORDS) as u32;
    answer[2] = (built.cell as f32).to_bits();
    // The columns' order in the answer: triangles, albedo, node bounds, node children, sources.
    let mut ordered = Vec::new();
    for float in &built.triangles {
        ordered.extend_from_slice(&float.to_le_bytes());
    }
    for word in &built.albedo {
        ordered.extend_from_slice(&word.to_le_bytes());
    }
    for float in &built.node_bounds {
        ordered.extend_from_slice(&float.to_le_bytes());
    }
    for word in &built.node_children {
        ordered.extend_from_slice(&word.to_le_bytes());
    }
    for word in &built.sources {
        ordered.extend_from_slice(&word.to_le_bytes());
    }
    COLUMNS.with(|held| *held.borrow_mut() = ordered);
    0
}

/// Copies the columns `proxy_build` wrote into `out` and forgets them.
///
/// # Safety
/// `out` must lie in a live `arena_alloc` reservation of at least their byte length.
#[no_mangle]
pub unsafe extern "C" fn proxy_build_take(out: u32) {
    COLUMNS.with(|held| {
        let columns = held.take();
        core::slice::from_raw_parts_mut(out as *mut u8, columns.len()).copy_from_slice(&columns);
    });
}
