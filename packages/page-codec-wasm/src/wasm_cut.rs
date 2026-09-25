//! Raw ABI of the cut's node walk (`cut.rs`): byte offsets into `arena_alloc` reservations, like
//! `wasm_math.rs`. The loader is `packages/sdk-browser/src/page/cut/walkWasm.ts`.

use crate::cut::walk;
use crate::cut_error::{Lens, PLANE_VALUES};

/// Floats of the lens block: planes, view elements, then stretch, focal length, near plane,
/// perspective weight, pixel threshold and the exact flag (0 or 1).
pub const LENS_VALUES: usize = PLANE_VALUES + 16 + 6;

/// Walks the hierarchy and returns 0 with `result` = leaves written, nodes tested, frustum
/// rejects; or 1 when the JavaScript descent must run instead (`cut::Bail`), `result` untouched.
///
/// # Safety
/// Every offset must lie in a live `arena_alloc` reservation: `nodes` and `bounds` hold
/// `node_values` and `bound_values` floats, `open` `open_len` words (0: no node open), `lens`
/// `LENS_VALUES` floats, `stack` and `leaves` `stack_len` and `leaves_len` words, `result` three
/// words; the ranges are disjoint.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn cut_walk(
    nodes: u32,
    node_values: usize,
    stride: usize,
    bounds: u32,
    bound_values: usize,
    open: u32,
    open_len: usize,
    lens: u32,
    stack: u32,
    stack_len: usize,
    leaves: u32,
    leaves_len: usize,
    result: u32,
) -> u32 {
    let v = core::slice::from_raw_parts(lens as *const f64, LENS_VALUES);
    let s = PLANE_VALUES + 16;
    let lens = Lens {
        planes: v[..PLANE_VALUES].try_into().unwrap_or([0.0; PLANE_VALUES]),
        view: v[PLANE_VALUES..s].try_into().unwrap_or([0.0; 16]),
        stretch: v[s],
        focal: v[s + 1],
        near: v[s + 2],
        perspective: v[s + 3],
        pixel_error: v[s + 4],
        exact: v[s + 5] != 0.0,
    };
    let walked = walk(
        core::slice::from_raw_parts(nodes as *const f64, node_values),
        stride,
        core::slice::from_raw_parts(bounds as *const f64, bound_values),
        if open_len == 0 {
            &[]
        } else {
            core::slice::from_raw_parts(open as *const u32, open_len)
        },
        &lens,
        core::slice::from_raw_parts_mut(stack as *mut u32, stack_len),
        core::slice::from_raw_parts_mut(leaves as *mut u32, leaves_len),
    );
    let Ok(done) = walked else { return 1 };
    let out = core::slice::from_raw_parts_mut(result as *mut u32, 3);
    out.copy_from_slice(&[done.leaves as u32, done.nodes_tested, done.frustum_rejected]);
    0
}
