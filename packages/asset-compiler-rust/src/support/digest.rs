//! A key of any length held in 128 bits (`digest_words`): the first half of the SHA-256 of its
//! words, so a map keyed by shapes — a chart's raster, a triangle's attributes — keeps 16 bytes a
//! key however long the shape is, and two shapes alike have one key while two unlike have one with
//! a collision odds of 2^-128.
use sha2::{Digest, Sha256};

/// The first 128 bits of the SHA-256 of `words`, each four bytes little-endian, read as a
/// little-endian number.
pub(crate) fn digest_words(words: impl IntoIterator<Item = u32>) -> u128 {
    let mut hasher = Sha256::new();
    for word in words {
        hasher.update(word.to_le_bytes());
    }
    let mut half = [0u8; 16];
    half.copy_from_slice(&hasher.finalize()[..16]);
    u128::from_le_bytes(half)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The first 128 bits of the SHA-256 of the words' bytes, hashed in one piece.
    fn in_one_piece(words: &[u32]) -> u128 {
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        u128::from_le_bytes(
            Sha256::digest(&bytes)[..16]
                .try_into()
                .expect("sixteen bytes"),
        )
    }

    #[test]
    fn a_key_is_the_digest_of_the_bytes_of_its_words() {
        let words: Vec<u32> = (0..100).map(|w| w * 0x0101_0101 + 7).collect();
        assert_eq!(digest_words(words.iter().copied()), in_one_piece(&words));
        assert_eq!(digest_words([]), in_one_piece(&[]));
    }

    #[test]
    fn words_that_differ_by_one_or_by_a_zero_more_have_two_keys() {
        let mut words: Vec<u32> = (0..100).collect();
        let key = digest_words(words.iter().copied());
        words[63] += 1;
        assert_ne!(key, digest_words(words.iter().copied()));
        assert_ne!(digest_words([1, 2, 3]), digest_words([1, 2, 3, 0]));
        assert_ne!(digest_words([]), digest_words([0]));
    }
}
