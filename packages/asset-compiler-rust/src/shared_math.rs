//! Shared formulas across native compiler stages.
//!
//! Single copy of calculations shared by several stages:
//! same float ops, same order, same precision as original location.
//! Site with detail difference stays local rather than aligned.

pub(crate) mod wide;

use trillion3d_math::aabb::aabb_of;
pub(crate) use trillion3d_math::aabb::longest_axis;
pub(crate) use trillion3d_math::linear::{linear_columns, uniform_scale};
use trillion3d_math::random::hash_word;
pub(crate) use trillion3d_math::vec3::{normalized_or, unit};

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

/// Multiplicative hash, word by word: SipHash dominated mesh conversion (the corner values), the
/// Hausdorff grid's cell lookups and the DAG builder's maps. Its order is the same on every
/// run; an output still never follows it — a map is read by key, counted, or its entries sorted
/// before they are written.
#[derive(Default, Clone, Copy)]
pub(crate) struct WordHasher(u64);
impl WordHasher {
    fn mix(&mut self, word: u64) {
        self.0 = hash_word(self.0, word);
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

/// Elapsed milliseconds from instant: compiler publishes durations in
/// milliseconds only, converting in one place prevents seconds leak.
pub fn elapsed_ms(since: std::time::Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}
