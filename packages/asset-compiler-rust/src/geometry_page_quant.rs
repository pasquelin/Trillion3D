//! The grids of a cluster page: object-grid positions and texture coordinates with per-cluster
//! widths, byte colours. The encoders and their inverses live together in the shared codec
//! (`trillion3d_page_codec::bits`): the encoder measures its own error with the very function
//! every reader decodes with.

use crate::{CompilerError, Result};
use trillion3d_math::aabb::longest_side;
/// The grid rules, shared with the run-time cut (`trillion3d_page_codec::bits::grid`).
use trillion3d_page_codec::bits::grid::{primitive_grid_exponent, uv_grid_exponent};
use trillion3d_page_codec::bits::{self, Quant, QuantRefusal};
#[cfg(test)]
mod screen;
pub mod tile;
#[cfg(test)]
mod wide_tests;

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

/// Texture coordinates sit on a fixed grid of 2^-14: a quarter of a texel on a 4096 map.
pub use trillion3d_page_codec::bits::grid::UV_EXPONENT;

/// The texture grid of a primitive: the format's, or for a `blended` one the finest grid the
/// widest span of its texture coordinates fits, never coarser than the format's.
pub fn primitive_uv_exponent(carried: &[&crate::geometry_page::Attribute], blended: bool) -> i32 {
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
/// Colours sit on a grid of 2^-8: 0 and 1 exact, a constant channel free.
pub const COLOR_EXPONENT: i32 = -8;

/// A vector attribute on its grid (`bits::quantize`): `values` holds `N` floats per vertex — at
/// least one, a page having at least one corner —, `exponent` is the grid the caller fixed for the
/// whole primitive and is never widened here — a page whose range needs more than `MAX_BITS` on
/// that grid is refused as `PAGE_ATTRIBUTE_RANGE`, since a page on a grid of its own would no
/// longer share its border vertices' cells with its neighbours. A loop over every vertex of every
/// page: AVX2 where the processor has it (`shared_math::wide`).
pub fn quantize<const N: usize>(
    values: &[f32],
    exponent: i32,
) -> Result<(Quant<N>, Vec<[u32; N]>)> {
    crate::shared_math::wide::wide(|| bits::quantize::<N>(values, exponent)).map_err(|refusal| {
        match refusal {
            QuantRefusal::Range => CompilerError::new(
                "PAGE_ATTRIBUTE_RANGE",
                "Page attribute range exceeds 2^24 steps of its primitive grid",
            ),
            QuantRefusal::Overflow => CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                "Page attribute minimum overflows a float",
            ),
        }
    })
}

/// The error bound a page header carries (`bits::quantization_error`), AVX2 where the processor
/// has it, as `quantize`.
pub fn max_error<const N: usize>(values: &[f32], record: &Quant<N>, offsets: &[[u32; N]]) -> f32 {
    crate::shared_math::wide::wide(|| bits::quantization_error::<N>(values, record, offsets))
}
