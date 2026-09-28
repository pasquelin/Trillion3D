//! Shared formulas across native compiler stages.
//!
//! Single copy of calculations previously in multiple copies:
//! same float ops, same order, same precision as original location.
//! Site with detail difference stays local rather than aligned.

/// Extends bounding box by another box, axis by axis in axis order.
///
/// `f64::min` and `f64::max` keep semantics: NaN in read box leaves bound
/// as is, NaN in bound replaced by coordinate. Min corner compared
/// only to min corner and max to max corner: no extra comparison deciding
/// differently between `+0.0` and `−0.0`.
pub(crate) fn merge_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    other_low: [f64; N],
    other_high: [f64; N],
) {
    for axis in 0..N {
        low[axis] = low[axis].min(other_low[axis]);
        high[axis] = high[axis].max(other_high[axis]);
    }
}

/// Extends bounding box by point: box reduced to point.
pub(crate) fn extend_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    point: [f64; N],
) {
    merge_aabb(low, high, point, point);
}

/// Axis along which box widest. On tie, first axis wins:
/// strict `>` comparison, NaN extent never alters choice.
pub(crate) fn longest_axis(low: &[f64; 3], high: &[f64; 3]) -> usize {
    let mut axis = 0;
    for a in 1..3 {
        if high[a] - low[a] > high[axis] - low[axis] {
            axis = a;
        }
    }
    axis
}

/// Sorts group of ids on widest axis of centroids: median falls
/// on `slice.len() / 2`, splitting group into two spatial halves.
///
/// Comparator sorts by coordinate (`total_cmp`, so NaN has a place), then by
/// identifier: two coincident centroids keep same order from build to build.
pub(crate) fn bisect_centres(slice: &mut [usize], centres: &[[f64; 3]]) {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for &id in slice.iter() {
        extend_aabb(&mut low, &mut high, centres[id]);
    }
    let axis = longest_axis(&low, &high);
    slice.sort_unstable_by(|&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    });
}

/// Same box in single precision: site accumulating `f32` does not go through `f64`.
pub(crate) fn extend_aabb_f32<const N: usize>(
    low: &mut [f32; N],
    high: &mut [f32; N],
    point: [f32; N],
) {
    for axis in 0..N {
        low[axis] = low[axis].min(point[axis]);
        high[axis] = high[axis].max(point[axis]);
    }
}

/// Padding bytes to reach next multiple of four: zero when already
/// aligned. Alignment binary format requires of views.
pub(crate) fn pad_to_4(length: usize) -> usize {
    (4 - length % 4) % 4
}

/// Small vector algebra on `[f64; 3]`, written once in the page codec beside the normal cone that
/// reads it (`trillion3d_page_codec::vec3`): the compiler carries one implementation of each.
pub use trillion3d_page_codec::vec3::{cross, divide, dot, length, point, scale, sub};

/// Unit vector, or fallback when length stays under 1e-12: shorter,
/// vector carries no direction and division makes no sense. Fallback belongs to
/// site — light looks towards `-Z`, missing normal points up — so passed in.
pub(crate) fn normalized_or(vector: [f64; 3], fallback: [f64; 3]) -> [f64; 3] {
    let norm = length(vector);
    if norm > 1e-12 {
        divide(vector, norm)
    } else {
        fallback
    }
}

/// `v` at unit length, if it has a finite, non-zero one.
pub(crate) fn unit(v: [f64; 3]) -> Option<[f64; 3]> {
    let length = length(v);
    (length > 0.0 && length.is_finite()).then(|| scale(v, 1.0 / length))
}

/// The golden-ratio step of SplitMix64 (Steele et al. 2014), between two draws.
pub(crate) const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// `x` mixed by SplitMix64's finaliser into [0, 1): its top 53 bits, exact in an f64 (all 64 would
/// round up to 1 near `u64::MAX`).
pub(crate) fn splitmix_unit(x: u64) -> f64 {
    let x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((x ^ (x >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// Elapsed milliseconds from instant: compiler publishes durations in
/// milliseconds only, converting in one place prevents seconds leak.
pub fn elapsed_ms(since: std::time::Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

/// Equivalent uniform scale of 4x4 column matrix: cube root of
/// volume linear part multiplies. Needed to transform length — light
/// radius — from local space to world. Non-uniform matrix yields geometric
/// mean of three scales, mirror yields same scale as reflection, degenerate
/// matrix yields zero: zero length discarded by caller.
pub(crate) fn uniform_scale(m: &[f64; 16]) -> f64 {
    let [x, y, z] = linear_columns(m);
    dot(x, cross(y, z)).abs().cbrt()
}

/// The three columns of the linear part of a column-major 4x4 matrix.
pub(crate) fn linear_columns(m: &[f64; 16]) -> [[f64; 3]; 3] {
    [0, 1, 2].map(|c| [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]])
}
