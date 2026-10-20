//! The position and texture grids of a primitive, written once for both cuts: the compiler's
//! (`geometry_page_quant::primitive_exponent`, `primitive_uv_exponent`) and the one the engine
//! runs on drawn triangles or on a compiled primitive's own clusters
//! (`packages/sdk-browser/src/world/page/runtimeCut.ts`), through the SDK module
//! (`wasm_encode.rs`). Their logarithms are read from the bits (`log2.rs`): both cuts take the
//! same integers on every host.

use super::log2::{ceil_log2, floor_log2};
use super::{MAX_BITS, MAX_EXPONENT};
use trillion3d_math::aabb::{aabb_of, longest_side};

/// A tile spans 2^1 = 2 m of the world, in 2^16 steps: primitives wider than 2 m sit on 2^-15 m
/// (30.5 µm), the finest the page field allows below that (`finest_exponent`). The grid is the
/// only bound on a leaf page's error: the cut already counts it on every produced cluster
/// (`quantizationErrorOf`, sdk-browser), but a leaf has nothing finer to refine to. A leaf moves the
/// source by at most √3/2 of a step, 26.4 µm, which projects to 0.057 px at a metre on the reference
/// display (2234 lines under a 55° vertical field, focal 2146 px), under the display quantum of
/// 0.1 px down to 57 cm; 2^-14 would be 0.11 px at a metre. A kilometre primitive
/// stops at the page field: its DAG root spans it, 2^23 steps at most (2^-13 m on 1,024 m).
pub const TILE_EXTENT_LOG2: i32 = 1;

/// Texture coordinates sit on a fixed grid of 2^-14: a quarter of a texel on a 4096 map.
pub const UV_EXPONENT: i32 = -14;

/// A tile's width, as a power of two in object units, for a primitive the largest world `scale`
/// places: 2 m in those units, a missing, zero or non-finite scale taken as a metre per unit.
/// Rounded down: a tile never spans more than 2 m.
pub fn tile_log2(scale: Option<f64>) -> i32 {
    floor_log2(object_units(2f64.powi(TILE_EXTENT_LOG2), scale))
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
/// bounded below by the finest grid a page as wide as the primitive fits (`finest_exponent`), so no
/// page needs more than `MAX_BITS` per coordinate. Every page shares that exponent and rounds
/// absolute coordinates: a vertex two clusters or two tiles share lands on one cell. The step is a
/// power of two: `q * step` is exact.
pub fn grid_exponent(extent: f64, finest_error: Option<f64>, tile_log2: i32) -> i32 {
    let (widest, finest) = if extent > 0.0 {
        (floor_log2(extent), finest_exponent(extent))
    } else {
        (0, -(MAX_BITS as i32 - 2))
    };
    let by_extent = widest.min(tile_log2) - 16;
    let by_error = finest_error.map_or(by_extent, |e| floor_log2(e / 8.0));
    by_extent
        .min(by_error)
        .max(finest)
        .clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// The finest grid on which a positive `span` fits a page's field: at most 2^23 steps, which
/// rounding at both ends keeps under the 2^`MAX_BITS` a page holds, so a blended surface sits on
/// one grid however it is cut.
pub fn finest_exponent(span: f64) -> i32 {
    // Saturating: a span of 0 gives `i32::MIN`, which a plain subtraction would wrap to the coarsest grid.
    ceil_log2(span)
        .saturating_sub(MAX_BITS as i32 - 1)
        .clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// The grid of a primitive of widest `extent`: a `blended` one takes the finest grid its pages
/// hold, a coarser one showing through a transparent surface; any other `grid_exponent`.
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

/// The texture grid of a primitive whose pages may hold a texture-coordinate span of `span`: the
/// one rule of both cuts. Never coarser than the format's 2^`UV_EXPONENT`: a `blended` primitive
/// takes the finest grid that span fits, one grid however it is cut, finer than the format's when
/// the span allows; any other the format's. A page whose own span would not fit its field takes
/// the coarser grid that holds it, alone (`page_uv_exponent`): no primitive pays for one page.
pub fn uv_grid_exponent(span: f64, blended: bool) -> i32 {
    match blended && span > 0.0 {
        true => finest_exponent(span).min(UV_EXPONENT),
        false => UV_EXPONENT,
    }
}

/// The texture grid one page is written on: the primitive's `grid`, coarser only when the page's
/// own coordinates (`values`, two floats a vertex) span more than its field holds there. Each page
/// carries its exponent and its minimum, so only that page's precision moves.
pub fn page_uv_exponent(grid: i32, values: &[f32]) -> i32 {
    let span = widest_uv_span(values, &[], &[]);
    match span > 0.0 {
        true => grid.max(finest_exponent(span)),
        false => grid,
    }
}

/// The longest side of the box of `positions` (three floats a vertex): the extent a primitive's
/// position grid is set by, measured the same way by both cuts.
pub fn positions_extent(positions: &[f32]) -> f64 {
    let b = crate::proxy::bvh::extent(positions);
    longest_side([b[0], b[1], b[2]], [b[3], b[4], b[5]])
}

/// The widest range of either texture coordinate a page holds: over the corners of each of
/// `ranges` (ranks into `corners`), or over every vertex of `uvs` when `ranges` is empty — a
/// primitive whose DAG pages may hold it whole. The span `uv_grid_exponent` reads, measured the
/// same way by both cuts.
pub fn widest_uv_span(uvs: &[f32], corners: &[u32], ranges: &[[u32; 2]]) -> f64 {
    let pairs = uvs.as_chunks::<2>().0;
    let span = |vertices: &mut dyn Iterator<Item = usize>| {
        let points = vertices
            .filter_map(|v| pairs.get(v))
            .map(|uv| uv.map(f64::from));
        let (low, high) = aabb_of::<2>(points);
        longest_side(low, high)
    };
    if ranges.is_empty() {
        return span(&mut (0..pairs.len()));
    }
    ranges
        .iter()
        .map(|&[start, end]| {
            let corners = corners.get(start as usize..end as usize).unwrap_or(&[]);
            span(&mut corners.iter().map(|&v| v as usize))
        })
        .fold(0.0, f64::max)
}

#[cfg(test)]
#[path = "grid_tests.rs"]
mod tests;
