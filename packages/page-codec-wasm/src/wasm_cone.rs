//! Raw ABI of the normal cone (`normal_cone.rs`) and the position grid (`bits/grid.rs`) for the
//! pages the world cuts at run time: byte offsets into `arena_alloc` reservations, like
//! `wasm_cut.rs`. The loaders are `packages/sdk-browser/src/world/page/cutCones.ts` and `cutGrid.ts`.

use crate::bits::grid::{grid_exponent, TILE_EXTENT_LOG2};
use crate::normal_cone::cluster_cones;

/// The compiler's grid exponent for a primitive of widest `extent`, placed at no known world
/// scale (a metre per unit) and with no DAG: every run-time cluster is a root, drawn as it is.
#[no_mangle]
pub extern "C" fn position_grid_exponent(extent: f64) -> i32 {
    grid_exponent(extent, None, TILE_EXTENT_LOG2)
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
