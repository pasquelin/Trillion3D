//! The word-by-word hash of the maps the encoder and the compiler key by integers.

use trillion3d_math::random::hash_word;

/// Multiplicative hash, word by word: SipHash dominated mesh conversion (the corner values), the
/// Hausdorff grid's cell lookups and the DAG builder's maps. Its order is the same on every
/// run; an output still never follows it — a map is read by key, counted, or its entries sorted
/// before they are written.
#[derive(Default, Clone, Copy)]
pub struct WordHasher(u64);
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
pub type WordMap<K, V> = std::collections::HashMap<K, V, std::hash::BuildHasherDefault<WordHasher>>;
/// An empty [`WordMap`] with room for `capacity` entries.
pub fn word_map<K, V>(capacity: usize) -> WordMap<K, V> {
    WordMap::with_capacity_and_hasher(capacity, Default::default())
}
/// A set hashed by [`WordHasher`].
pub type WordSet<T> = std::collections::HashSet<T, std::hash::BuildHasherDefault<WordHasher>>;
