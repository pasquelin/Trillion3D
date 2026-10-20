//! Raw ABI of the grids of a primitive the engine cuts at run time: the measures and the rules
//! of `bits/grid.rs`, the very ones the compiler runs, so a page cut here sits on the grid the
//! compiler would give it. Byte offsets into `arena_alloc` reservations, like `wasm_encode.rs`.

use crate::bits::grid::{
    positions_extent, primitive_grid_exponent, tile_log2, uv_grid_exponent, widest_uv_span,
};
use crate::wasm_math::{view, view_mut, view_or_empty};

/// The position and texture grids of `vertex_count` `positions` (× 3 floats) and their `uvs`
/// (× 2 floats, 0 for none), written as two signed words at `out`. The texture span is measured
/// over the `range_count` corner ranges at `ranges` (two words each, into the `indices` words),
/// or over every vertex when there are none — a compiled primitive cut again, whose pages may hold
/// it whole. `finest_error` and `scale` are NaN where the compiler knew none (drawn triangles:
/// no DAG, a metre per unit); `blended` 0 or 1.
///
/// # Safety
/// Every offset must lie in a live `arena_alloc` reservation of the size it states.
#[no_mangle]
pub unsafe extern "C" fn grid_exponents(
    positions: u32,
    vertex_count: u32,
    uvs: u32,
    indices: u32,
    ranges: u32,
    range_count: u32,
    blended: u32,
    finest_error: f64,
    scale: f64,
    out: u32,
) {
    let count = vertex_count as usize;
    let positions = view_or_empty(positions, count * 3);
    let ranges: &[[u32; 2]] = view_or_empty(ranges, range_count as usize);
    let corners = ranges.iter().map(|r| r[1]).max().unwrap_or(0) as usize;
    let indices = view_or_empty(indices, corners);
    let span = match (uvs, count) {
        (0, _) | (_, 0) => 0.0,
        _ => widest_uv_span(view(uvs, count * 2), indices, ranges),
    };
    let blended = blended != 0;
    let known = |value: f64| (!value.is_nan()).then_some(value);
    let tile = tile_log2(known(scale));
    let position = primitive_grid_exponent(
        positions_extent(positions),
        known(finest_error),
        blended,
        tile,
    );
    let out = view_mut::<i32>(out, 2);
    out[0] = position;
    out[1] = uv_grid_exponent(span, blended);
}
