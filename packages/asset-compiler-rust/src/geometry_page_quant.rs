//! Quantizers of a cluster page: object-grid positions and texture coordinates with per-cluster
//! widths, octahedral normals, byte colours, and the bit writer that packs them. The inverse
//! formulas live in the shared codec (`web_geometry_page_codec::bits`): the encoder measures its
//! own error with the very function every reader decodes with.

use crate::{CompilerError, Result};
use web_geometry_page_codec::bits::{
    bits_for, dequant, oct_decode, pow2, Quant, MAX_BITS, MAX_EXPONENT,
};

/// Grid of a primitive, the finer of two rules: its widest extent split into 2^16 steps, and an
/// eighth of the finest group error its DAG published — so a cluster's displacement projects
/// below an eighth of the threshold wherever the cut selects it. The error rule is bounded below
/// by the extent in 2^(`MAX_BITS` - 2) steps, so no page of the primitive, rounding included,
/// ever needs more than `MAX_BITS` per coordinate: every page shares the primitive's exponent,
/// and shared vertices between clusters land on the same cells. The step is a power of two, so
/// every decoded coordinate is `min + q * step` with an exact product.
pub fn grid_exponent(extent: f64, finest_error: Option<f64>) -> i32 {
    let widest = if extent > 0.0 {
        extent.log2().floor() as i32
    } else {
        0
    };
    let by_extent = widest - 16;
    let by_error = finest_error.map_or(by_extent, |e| (e / 8.0).log2().floor() as i32);
    let finest = widest - (MAX_BITS as i32 - 2);
    by_extent
        .min(by_error)
        .max(finest)
        .clamp(-MAX_EXPONENT, MAX_EXPONENT)
}

/// The grid of a primitive from its positions and the errors its DAG published; a zero error is
/// a root's, not a rule.
pub fn primitive_exponent(pos: &[f32], errors: impl Iterator<Item = f64>) -> i32 {
    let bounds = crate::proxy::bvh::extent(pos);
    let extent = (0..3)
        .map(|axis| bounds[axis + 3] - bounds[axis])
        .fold(0.0, f64::max);
    grid_exponent(extent, errors.filter(|e| *e > 0.0).min_by(f64::total_cmp))
}

/// Texture coordinates sit on a fixed grid of 2^-14: a quarter of a texel on a 4096 map.
pub const UV_EXPONENT: i32 = -14;
/// Colours sit on a grid of 2^-8: 0 and 1 exact, a constant channel free.
pub const COLOR_EXPONENT: i32 = -8;

/// A vector attribute on its grid: `values` holds `N` floats per vertex — at least one, a page
/// having at least one corner —, `exponent` is the grid
/// the caller fixed for the whole primitive and is never widened here — a page whose range needs
/// more than `MAX_BITS` on that grid is refused as `PAGE_ATTRIBUTE_RANGE`, since a page on a
/// grid of its own would no longer share its border vertices' cells with its neighbours.
/// Returns the record and, per vertex, the `N` grid offsets from the page minimum.
pub fn quantize<const N: usize>(
    values: &[f32],
    exponent: i32,
) -> Result<(Quant<N>, Vec<[u32; N]>)> {
    let count = values.len() / N;
    let step = f64::from(pow2(exponent));
    let mut lo = [f64::INFINITY; N];
    let mut hi = [f64::NEG_INFINITY; N];
    let grid: Vec<[f64; N]> = (0..count)
        .map(|i| {
            std::array::from_fn(|c| {
                let cell = (f64::from(values[i * N + c]) / step).round();
                lo[c] = lo[c].min(cell);
                hi[c] = hi[c].max(cell);
                cell
            })
        })
        .collect();
    let range = |c: usize| hi[c] - lo[c];
    if (0..N).any(|c| range(c) >= (1u64 << MAX_BITS) as f64) {
        return Err(CompilerError::new(
            "PAGE_ATTRIBUTE_RANGE",
            "Page attribute range exceeds 2^24 steps of its primitive grid",
        ));
    }
    let bits: [u32; N] = std::array::from_fn(|c| bits_for(range(c) as u32));
    let min: [f32; N] = std::array::from_fn(|c| (lo[c] * step) as f32);
    if min.iter().any(|m| !m.is_finite()) {
        return Err(CompilerError::new(
            "INVALID_PAGE_ATTRIBUTE",
            "Page attribute minimum overflows a float",
        ));
    }
    let offsets = grid
        .iter()
        .map(|cell| std::array::from_fn(|c| (cell[c] - lo[c]) as u32))
        .collect();
    Ok((
        Quant {
            min,
            exponent,
            bits,
        },
        offsets,
    ))
}

/// Largest distance between a source vector and its decoded value, over the page, in the units
/// of the attribute: measured with the reader's own arithmetic, as the `f32` the header carries,
/// rounded up so that no displacement exceeds it.
pub fn max_error<const N: usize>(values: &[f32], record: &Quant<N>, offsets: &[[u32; N]]) -> f32 {
    let step = record.step();
    let worst = offsets
        .iter()
        .enumerate()
        .map(|(i, cell)| {
            (0..N)
                .map(|c| {
                    let decoded = dequant(record.min[c], cell[c], step);
                    (f64::from(decoded) - f64::from(values[i * N + c])).powi(2)
                })
                .sum::<f64>()
                .sqrt()
        })
        .fold(0.0, f64::max);
    let rounded = worst as f32;
    if f64::from(rounded) < worst {
        rounded.next_up()
    } else {
        rounded
    }
}

/// Octahedral encoding of a normal into two bytes, `x` low and `y` high. Of the four roundings
/// of the projected point, the one that decodes closest to the source is kept: the "precise"
/// variant of the survey the format follows. A zero normal has no direction and takes `+z`.
pub fn oct_encode(normal: [f32; 3]) -> u32 {
    let [x, y, z] = normal;
    let sum = x.abs() + y.abs() + z.abs();
    if sum == 0.0 || !sum.is_finite() {
        return 128 | (128 << 8);
    }
    let (px, py) = (x / sum, y / sum);
    let (px, py) = if z < 0.0 {
        (
            (1.0 - py.abs()) * if px >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - px.abs()) * if py >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (px, py)
    };
    let cell = |v: f32| ((v + 1.0) * 127.5).floor().clamp(0.0, 254.0) as u32;
    let (bx, by) = (cell(px), cell(py));
    let length = (x * x + y * y + z * z).sqrt();
    let unit = [x / length, y / length, z / length];
    let mut best = (f32::INFINITY, 0u32);
    for candidate in [bx, bx + 1]
        .into_iter()
        .flat_map(|qx| [qx | (by << 8), qx | ((by + 1) << 8)])
    {
        let [dx, dy, dz] = oct_decode(candidate);
        let dot = dx * unit[0] + dy * unit[1] + dz * unit[2];
        let error = 1.0 - dot;
        if error < best.0 {
            best = (error, candidate);
        }
    }
    best.1
}
