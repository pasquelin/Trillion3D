//! A scrambled two-dimensional Sobol' sequence: each draw scrambles its index and its two
//! coordinates by an Owen scrambling of its own, keyed by a seed that moves at every use — the
//! points of one index are as well spread as Sobol's, those of two seeds uncorrelated.

/// The seed moved one step, a multiplicative congruential increment, and the hash of the moved
/// seed returned.
#[inline]
pub fn evolve_seed(seed: &mut u32) -> u32 {
    *seed = seed.wrapping_add(2_739_110_765);
    let mut hash = seed.wrapping_mul(0x9295_5555);
    hash ^= hash >> 15;
    hash
}

/// `index` scrambled by `seed` (Laine and Karras): the seed added, two multiply-xor rounds, the
/// bits reversed.
#[inline]
pub fn owen_scrambled(index: u32, seed: u32) -> u32 {
    let mut index = index.wrapping_add(seed);
    index ^= index.wrapping_mul(0x9c11_7646);
    index ^= index.wrapping_mul(0xe070_5d72);
    index.reverse_bits()
}

/// The point of `index` in `[0, 1)²`, the seed moved three times: the index scrambled, its
/// second coordinate computed without iteration (bit-reversed), both coordinates scrambled, then
/// their top 24 bits over 2²⁴.
pub fn sobol_point(index: u32, seed: &mut u32) -> [f64; 2] {
    let scrambled = owen_scrambled(index, evolve_seed(seed));
    let mut y = scrambled;
    y ^= y >> 16;
    y ^= (y & 0xFF00_FF00) >> 8;
    y ^= (y & 0xF0F0_F0F0) >> 4;
    y ^= (y & 0xCCCC_CCCC) >> 2;
    y ^= (y & 0xAAAA_AAAA) >> 1;
    let x = owen_scrambled(scrambled, evolve_seed(seed));
    let y = owen_scrambled(y, evolve_seed(seed));
    let unit = |w: u32| f64::from(w >> 8) / f64::from(1u32 << 24);
    [unit(x), unit(y)]
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: the sequence is the published one bit for bit: points of three indices from seed
    // 0, against the published integer steps run apart (wrapping 32-bit arithmetic), in units of
    // 2⁻²⁴; the seed moves three steps a point.
    #[test]
    fn the_points_are_the_published_sequence() {
        let cases = [
            (0, [3_593_829, 3_136_262]),
            (1u32.reverse_bits(), [14_083_651, 13_119_954]),
            (37u32.reverse_bits(), [11_582_003, 10_861_067]),
        ];
        for (index, [x, y]) in cases {
            let mut seed = 0;
            let unit = |w: u32| f64::from(w) / f64::from(1u32 << 24);
            assert_eq!(sobol_point(index, &mut seed), [unit(x), unit(y)]);
            assert_eq!(seed, 3_922_364_999);
        }
    }

    // Behaviour: over a power of two of consecutive indices from one seed, the first coordinate
    // takes every one of that many equal strata once — the Sobol' property the scrambling keeps.
    #[test]
    fn consecutive_indices_fill_every_stratum_once() {
        let mut strata = [0u32; 16];
        for i in 0..16u32 {
            let mut seed = 0;
            let [x, _] = sobol_point(i.reverse_bits(), &mut seed);
            strata[(x * 16.0) as usize] += 1;
        }
        assert!(strata.iter().all(|&n| n == 1), "{strata:?}");
    }
}
