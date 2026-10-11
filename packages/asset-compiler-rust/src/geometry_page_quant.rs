//! The grids of a cluster page: object-grid positions and texture coordinates with per-cluster
//! widths, byte colours. The encoders and their inverses live together in the shared codec
//! (`trillion3d_page_codec::bits`): the encoder measures its own error with the very function
//! every reader decodes with.

use trillion3d_math::aabb::longest_side;
/// The grid rules, shared with the run-time cut (`trillion3d_page_codec::bits::grid`).
use trillion3d_page_codec::bits::grid::{primitive_grid_exponent, uv_grid_exponent, UV_EXPONENT};
#[cfg(test)]
mod screen;
pub mod tile;

/// The grid of a primitive from its positions and the errors its DAG published; a zero error is
/// a root's, not a rule. A `blended` primitive takes the finest grid its pages hold: a coarser
/// one shows through a transparent surface. `tile_log2` is its tile (`tile::tile_log2`).
pub fn primitive_exponent(
    pos: &[f32],
    errors: impl Iterator<Item = f64>,
    blended: bool,
    tile_log2: i32,
) -> i32 {
    let bounds = crate::proxy::bvh::extent(pos);
    let extent = longest_side(
        [bounds[0], bounds[1], bounds[2]],
        [bounds[3], bounds[4], bounds[5]],
    );
    let finest = errors.filter(|e| *e > 0.0).min_by(f64::total_cmp);
    primitive_grid_exponent(extent, finest, blended, tile_log2)
}

/// The texture grid of a primitive: the format's, or for a `blended` one the finest grid the
/// widest span of its texture coordinates fits, never coarser than the format's.
pub fn primitive_uv_exponent(
    carried: &[&trillion3d_page_codec::encode::Attribute],
    blended: bool,
) -> i32 {
    if !blended {
        return UV_EXPONENT;
    }
    let mut span = 0.0f64;
    for uv in carried.iter().filter(|a| a.width == 2) {
        let (low, high) =
            trillion3d_math::aabb::aabb_of_f32(uv.values.as_chunks::<2>().0.iter().copied());
        for axis in 0..2 {
            span = span.max(f64::from(high[axis]) - f64::from(low[axis]));
        }
    }
    uv_grid_exponent(span, true)
}
