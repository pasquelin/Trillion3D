//! The position and texture grids of a primitive, written once for both cuts: the compiler's
//! (`geometry_page_quant::primitive_exponent`, `primitive_uv_exponent`) and the one the engine
//! runs on drawn triangles or on a compiled primitive's own clusters
//! (`packages/sdk-browser/src/world/page/runtimeCut.ts`, through `wasm_cone.rs`).

use super::{MAX_BITS, MAX_EXPONENT};

/// A tile spans 2^5 = 32 m of the world (#930). Wider primitives sit on 2^-11 m (0.49 mm) up to
/// 4 km, where the 24-bit page field bounds the grid, so a kilometre terrain seen from 2 m
/// quantizes under half a pixel rather than several.
pub const TILE_EXTENT_LOG2: i32 = 5;

/// Texture coordinates sit on a fixed grid of 2^-14: a quarter of a texel on a 4096 map.
pub const UV_EXPONENT: i32 = -14;

/// A tile's width, as a power of two in object units, for a primitive the largest world `scale`
/// places: 32 m in those units, a missing, zero or non-finite scale taken as a metre per unit.
/// Rounded down: a tile never spans more than 32 m.
pub fn tile_log2(scale: Option<f64>) -> i32 {
    object_units(2f64.powi(TILE_EXTENT_LOG2), scale)
        .log2()
        .floor() as i32
}

/// A length of `metres` in the object units of a primitive the largest world `scale` places; a
/// missing, zero or non-finite scale leaves it as is, nothing guessed. The compiler's proxy
/// threshold maps by it too, so a tile and a proxy follow one scale.
pub fn object_units(metres: f64, scale: Option<f64>) -> f64 {
    match scale {
        Some(value) if value.is_finite() && value > 0.0 => metres / value,
        _ => metres,
    }
}

/// Grid of a primitive, the finer of two rules: its widest extent, capped at 2^`tile_log2`, split
/// into 2^16 steps, and an eighth of the finest group error its DAG published. Both are
/// bounded below by the extent in 2^(`MAX_BITS` - 2) steps, so no page needs more than `MAX_BITS`
/// per coordinate. Every page shares that exponent and rounds absolute coordinates: a vertex two
/// clusters or two tiles share lands on one cell. The step is a power of two: `q * step` is exact.
pub fn grid_exponent(extent: f64, finest_error: Option<f64>, tile_log2: i32) -> i32 {
    let widest = if extent > 0.0 {
        extent.log2().floor() as i32
    } else {
        0
    };
    let by_extent = widest.min(tile_log2) - 16;
    let by_error = finest_error.map_or(by_extent, |e| (e / 8.0).log2().floor() as i32);
    let finest = widest - (MAX_BITS as i32 - 2);
    by_extent
        .min(by_error)
        .max(finest)
        .clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// The finest grid on which a positive `span` fits a page's field: at most 2^23 steps, which
/// rounding at both ends keeps under the 2^`MAX_BITS` a page holds (`gridExponentFor`,
/// `pageGrids.ts`, for texture coordinates), so a blended surface sits on one grid however it is cut.
pub fn finest_exponent(span: f64) -> i32 {
    (span.log2().ceil() as i32 - (MAX_BITS as i32 - 1)).clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// The grid of a primitive of widest `extent`: a `blended` one takes the finest grid its pages
/// hold, a coarser one showing through a transparent surface (#875); any other `grid_exponent`.
/// The compiler passes its DAG's finest error and its tile; the run-time cut, whose clusters are
/// all roots, none and the tile of a metre per unit (`TILE_EXTENT_LOG2`).
pub fn primitive_grid_exponent(
    extent: f64,
    finest_error: Option<f64>,
    blended: bool,
    tile_log2: i32,
) -> i32 {
    if blended && extent > 0.0 {
        finest_exponent(extent)
    } else {
        grid_exponent(extent, finest_error, tile_log2)
    }
}

/// The texture grid of a primitive whose texture coordinates span `span` at most: the format's,
/// or for a `blended` one the finest grid that span fits, never coarser than the format's (#875).
pub fn uv_grid_exponent(span: f64, blended: bool) -> i32 {
    if blended && span > 0.0 {
        finest_exponent(span).min(UV_EXPONENT)
    } else {
        UV_EXPONENT
    }
}
