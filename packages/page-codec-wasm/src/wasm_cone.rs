//! Raw ABI of the normal cone (`normal_cone.rs`) and the grids (`bits/grid.rs`) for the pages
//! the engine cuts at run time: byte offsets into `arena_alloc` reservations, like
//! `wasm_cut.rs`. The loaders are `packages/sdk-browser/src/world/page/cutCones.ts` and `cutGrid.ts`.

use crate::bits::grid::{primitive_grid_exponent, tile_log2, uv_grid_exponent};
use crate::normal_cone::cluster_cones;

/// The position grid exponent of a primitive of widest `extent` (`primitive_grid_exponent`):
/// `finest_error` the finest error its DAG published and `scale` the largest world scale that
/// places it, each none when not positive — a world's drawn triangles have neither, a compiled
/// primitive cut again in session both (#846); `blended` is 0 or 1.
#[no_mangle]
pub extern "C" fn position_grid_exponent(
    extent: f64,
    blended: u32,
    finest_error: f64,
    scale: f64,
) -> i32 {
    let finest = (finest_error > 0.0).then_some(finest_error);
    let tile = tile_log2((scale > 0.0).then_some(scale));
    primitive_grid_exponent(extent, finest, blended != 0, tile)
}

/// The texture grid exponent of a compiled primitive whose texture coordinates span `span`
/// (`uv_grid_exponent`); `blended` is 0 or 1.
#[no_mangle]
pub extern "C" fn texture_grid_exponent(span: f64, blended: u32) -> i32 {
    uv_grid_exponent(span, blended != 0)
}

/// Writes the cone of each of `clusters` index ranges into `out` and returns 0; or 1, `out`
/// untouched, when a range or an index falls outside the positions and indices given.
///
/// # Safety
/// Every offset must lie in a live `arena_alloc` reservation: `positions` holds `position_values`
/// floats (`f32`), `indices` `index_values` words, `ranges` `2 · clusters` words and `out`
/// `4 · clusters` floats (`f64`); `out` overlaps no other reservation.
#[no_mangle]
pub unsafe extern "C" fn cone_clusters(
    positions: u32,
    position_values: usize,
    indices: u32,
    index_values: usize,
    ranges: u32,
    clusters: usize,
    out: u32,
) -> u32 {
    let written = cluster_cones(
        core::slice::from_raw_parts(positions as *const f32, position_values),
        core::slice::from_raw_parts(indices as *const u32, index_values),
        core::slice::from_raw_parts(ranges as *const u32, clusters * 2),
        core::slice::from_raw_parts_mut(out as *mut f64, clusters * 4),
    );
    u32::from(written.is_none())
}
