//! Raw ABI of the grid of a primitive the engine cuts at run time: the rule of
//! `../bits/grid.rs`, the very one the compiler runs on a mesh that names no precision, so a page
//! cut here sits on the grid the compiler would give it. Byte offsets into `arena_alloc`
//! reservations, like `encode.rs`.

use crate::bits::grid::{Extent, PageGrid, Precision};
use crate::wasm::math::{view_mut, view_or_empty};
use trillion3d_math::geometry::aabb::aabb_of_f32;

/// The position precision of `vertex_count` `positions` (× 3 floats) cut into the clusters of the
/// `range_count` corner ranges at `ranges` (two words each, into the `indices` words), each a
/// cluster of the finest level, written as one signed word at `out`. Returns 0, or 1 when a
/// cluster is too wide for the coarsest precision, `out` then untouched.
///
/// # Safety
/// Every offset must lie in a live `arena_alloc` reservation of the size it states.
#[no_mangle]
pub unsafe extern "C" fn grid_precision(
    positions: u32,
    vertex_count: u32,
    indices: u32,
    ranges: u32,
    range_count: u32,
    out: u32,
) -> u32 {
    let positions = view_or_empty::<f32>(positions, vertex_count as usize * 3)
        .as_chunks::<3>()
        .0;
    let ranges: &[[u32; 2]] = view_or_empty(ranges, range_count as usize);
    let corners = ranges.iter().map(|r| r[1]).max().unwrap_or(0) as usize;
    let indices: &[u32] = view_or_empty(indices, corners);
    let extents: Vec<Extent> = (ranges.iter())
        .filter_map(|&[start, end]| {
            let corners = indices.get(start as usize..end as usize)?;
            let points = corners
                .iter()
                .filter_map(|&v| positions.get(v as usize).copied());
            let (low, high) = aabb_of_f32(points);
            Some(Extent {
                low,
                high,
                finest: true,
            })
        })
        .filter(|extent| extent.low[0] <= extent.high[0])
        .collect();
    match PageGrid::of(Precision::default(), &extents) {
        Some(grid) => {
            view_mut::<i32>(out, 1)[0] = grid.position;
            0
        }
        None => 1,
    }
}
