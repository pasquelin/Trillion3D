//! Shared formulas across native compiler stages.
//!
//! Single copy of calculations shared by several stages:
//! same float ops, same order, same precision as original location.
//! Site with detail difference stays local rather than aligned.

pub(crate) mod wide;

use trillion3d_math::aabb::aabb_of;
pub(crate) use trillion3d_math::linear::{linear_columns, uniform_scale};
use trillion3d_math::vec3::{divide, length, scale};

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
    let (low, high) = aabb_of(slice.iter().map(|&id| centres[id]));
    let axis = longest_axis(&low, &high);
    slice.sort_unstable_by(|&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    });
}

/// Padding bytes to reach next multiple of four: zero when already
/// aligned. Alignment binary format requires of views.
pub(crate) fn pad_to_4(length: usize) -> usize {
    (4 - length % 4) % 4
}

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
    unit_where(v, |length| length > 0.0 && length.is_finite())
}

/// `v` times the reciprocal of its length, when `usable` accepts that length. The guard is the
/// caller's: `unit` refuses a non-finite length, the oracle only a non-positive one.
/// `normalized_or` divides each part instead: the two round apart, and each keeps its callers' bits.
pub(crate) fn unit_where(v: [f64; 3], usable: impl Fn(f64) -> bool) -> Option<[f64; 3]> {
    let length = length(v);
    usable(length).then(|| scale(v, 1.0 / length))
}

/// Multiplicative hash, word by word: SipHash dominated mesh conversion (the corner values), the
/// Hausdorff grid's cell lookups and the DAG builder's maps. Its order is the same on every
/// run; an output still never follows it — a map is read by key, counted, or its entries sorted
/// before they are written.
#[derive(Default, Clone, Copy)]
pub(crate) struct WordHasher(u64);
impl WordHasher {
    fn mix(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x517cc1b727220a95);
    }
}
impl std::hash::Hasher for WordHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        let (words, tail) = bytes.as_chunks::<8>();
        words.iter().for_each(|w| self.mix(u64::from_le_bytes(*w)));
        tail.iter().for_each(|&b| self.mix(b as u64));
    }
    fn write_u32(&mut self, v: u32) {
        self.mix(v as u64);
    }
}
/// A map hashed by [`WordHasher`].
pub(crate) type WordMap<K, V> =
    std::collections::HashMap<K, V, std::hash::BuildHasherDefault<WordHasher>>;
/// An empty [`WordMap`] with room for `capacity` entries.
pub(crate) fn word_map<K, V>(capacity: usize) -> WordMap<K, V> {
    WordMap::with_capacity_and_hasher(capacity, Default::default())
}
/// A set hashed by [`WordHasher`].
pub(crate) type WordSet<T> =
    std::collections::HashSet<T, std::hash::BuildHasherDefault<WordHasher>>;

/// `x` mixed by a 64-bit avalanche finaliser into [0, 1): its top 53 bits, exact in an f64 (all 64
/// would round up to 1 near `u64::MAX`). Its shifts and multipliers are declared, not tuned.
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
