//! The grids of a cluster page: object-grid positions and texture coordinates with per-cluster
//! widths, byte colours. The encoders and their inverses live together in the shared codec
//! (`trillion3d_page_codec::bits`): the encoder measures its own error with the very function
//! every reader decodes with.

/// The grid rules, shared with the run-time cut (`trillion3d_page_codec::bits::grid`).
use trillion3d_page_codec::bits::grid::{
    positions_extent, primitive_grid_exponent, uv_grid_exponent, widest_uv_span,
};
#[cfg(test)]
mod screen;
pub mod tile;

/// The grid of a primitive from its positions and the errors its DAG published; a zero error is
/// a root's, not a rule. A `blended` primitive takes the finest grid its pages hold: a coarser
/// one shows through a transparent surface. `tile_log2` is its tile (`bits::grid::tile_log2`).
/// The extent is measured as the run-time cut measures it (`positions_extent`).
pub fn primitive_exponent(
    pos: &[f32],
    errors: impl Iterator<Item = f64>,
    blended: bool,
    tile_log2: i32,
) -> i32 {
    let finest = errors.filter(|e| *e > 0.0).min_by(f64::total_cmp);
    primitive_grid_exponent(positions_extent(pos), finest, blended, tile_log2)
}

/// The texture grid of a primitive (`uv_grid_exponent`, the run-time cut's rule too), from the
/// widest span of its texture coordinates over every vertex (`widest_uv_span`): a DAG page may
/// hold the primitive whole, so that is the span every page must fit.
pub fn primitive_uv_exponent(
    carried: &[&trillion3d_page_codec::encode::Attribute],
    blended: bool,
) -> i32 {
    let span = carried
        .iter()
        .filter(|a| a.width == 2)
        .map(|uv| widest_uv_span(&uv.values, &[], &[]))
        .fold(0.0, f64::max);
    uv_grid_exponent(span, blended)
}
