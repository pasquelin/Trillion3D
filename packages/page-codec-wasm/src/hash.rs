//! The word-by-word hash of the maps the encoder and the compiler key by integers.

use trillion3d_math::sequence::random::{hash_word, WORD_HASH_MULTIPLIER};

/// Multiplicative hash, word by word, mixed down once the words are in (`finish`): SipHash
/// dominated mesh conversion (the corner values), the Hausdorff grid's cell lookups and the DAG
/// builder's maps. Its order is the same on every run; an output still never follows it — a map
/// is read by key, counted, or its entries sorted before they are written.
#[derive(Default, Clone, Copy)]
pub struct WordHasher(u64);
impl WordHasher {
    fn mix(&mut self, word: u64) {
        self.0 = hash_word(self.0, word);
    }
}
impl std::hash::Hasher for WordHasher {
    /// A product carries each bit upward only: its low bits, those a table picks its bucket by,
    /// read only the words' low bits, so keys alike there — grid coordinates packed high to low —
    /// all fall in one bucket. Its high half folded down, multiplied once more and folded again:
    /// the low bits then read the words' high bits too.
    fn finish(&self) -> u64 {
        let folded = (self.0 ^ (self.0 >> 32)).wrapping_mul(WORD_HASH_MULTIPLIER);
        folded ^ (folded >> 32)
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
pub type WordMap<K, V> = std::collections::HashMap<K, V, std::hash::BuildHasherDefault<WordHasher>>;
/// An empty [`WordMap`] with room for `capacity` entries.
pub fn word_map<K, V>(capacity: usize) -> WordMap<K, V> {
    WordMap::with_capacity_and_hasher(capacity, Default::default())
}
/// A set hashed by [`WordHasher`].
pub type WordSet<T> = std::collections::HashSet<T, std::hash::BuildHasherDefault<WordHasher>>;
