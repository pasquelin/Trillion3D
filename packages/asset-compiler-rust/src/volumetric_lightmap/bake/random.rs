//! The bake's random numbers: the integer hash, the scrambled Sobol' sequence that draws a path's
//! numbers, the Halton sequence that jitters a probe, and the Morton codes that seed them. Every
//! number is an integer operation, so a bake reproduces on any host.

/// The hash that spreads a position's bits (an avalanche hash; the sequence's per-position seed).
pub fn strong_hash(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x21f0_aaad);
    x ^= x >> 15;
    x = x.wrapping_mul(0xf35a_2d97);
    x ^ (x >> 15)
}

/// The Halton sequence of a prime `base` at `index`.
pub fn halton(mut index: u32, base: u32) -> f64 {
    let (mut result, mut factor) = (0.0f32, 1.0f32);
    let inverse = 1.0 / base as f32;
    while index > 0 {
        factor *= inverse;
        result += factor * (index % base) as f32;
        index /= base;
    }
    f64::from(result)
}

/// The bits of `x` spread two apart (ten bits in, thirty out).
pub fn morton_spread(mut x: u32) -> u32 {
    x &= 0x0000_03ff;
    x = (x ^ (x << 16)) & 0xff00_00ff;
    x = (x ^ (x << 8)) & 0x0300_f00f;
    x = (x ^ (x << 4)) & 0x030c_30c3;
    (x ^ (x << 2)) & 0x0924_9249
}

/// The probe's Morton index, which indexes its jitter: eight bits a side, the third axis shifted
/// like the second.
pub fn probe_morton(cell: [i64; 3]) -> u32 {
    let bits = |axis: usize| morton_spread((cell[axis] & 0xff) as u32);
    bits(0) | (bits(1) << 1) | (bits(2) << 1)
}

fn evolve(seed: &mut u32) -> u32 {
    *seed = seed.wrapping_mul(0x915f_77f5).wrapping_add(0x93d7_65dd);
    *seed
}

/// Owen scrambling of a bit-reversed index.
fn owen_scramble(mut index: u32, mut seed: u32) -> u32 {
    index ^= index.wrapping_mul(0xe070_5d72);
    index = index.wrapping_add(seed);
    seed ^= seed >> 16;
    index = index.wrapping_mul(seed | 1);
    index.reverse_bits()
}

/// The second Sobol' dimension of an index, then the third and fourth, from the closed forms of
/// the scrambled sequence.
fn sobol_dimensions(sobol: u32) -> [u32; 4] {
    let mut z = ((sobol >> 1) & 0x5055_0550) ^ (sobol & 0xaf5a_f5af) ^ ((sobol << 1) & 0xa0aa_0aa0);
    z ^= z << 16;
    z ^= (z & 0x00ff_00ff) << 8;
    z ^= (z & 0x0f0f_0f0f) << 4;
    z = ((z >> 1) & 0x5055_0550)
        ^ (z & 0x5fa5_fa5f)
        ^ ((z << 1) & 0xa4ea_4ea4)
        ^ ((z << 2) & 0xc84c_84c8)
        ^ ((z << 3) & 0x0880_8808);
    let reversed = z.reverse_bits();
    let (mut y, mut w) = (sobol, reversed);
    for (mask, shift) in [
        (0xffff_ffffu32, 16u32),
        (0xff00_ff00, 8),
        (0xf0f0_f0f0, 4),
        (0xcccc_cccc, 2),
        (0xaaaa_aaaa, 1),
    ] {
        y ^= (y & mask) >> shift;
        w ^= (w & mask) >> shift;
    }
    [sobol, y, reversed, w]
}

/// A path's random sequence: one point of the scrambled Sobol' sequence for the position's seed,
/// the index the pass, the dimensions advancing a draw at a time.
pub struct Sequence {
    index: u32,
    seed: u32,
}

impl Sequence {
    /// The sequence of a probe (`position_seed`) at a pass.
    pub fn new(position_seed: u32, pass: u32) -> Self {
        Self {
            index: pass.reverse_bits(),
            seed: strong_hash(position_seed),
        }
    }

    /// Four numbers in [0, 1), the upper 24 bits of each draw.
    pub fn next4(&mut self) -> [f64; 4] {
        let sobol = owen_scramble(self.index, evolve(&mut self.seed));
        let mut dimensions = sobol_dimensions(sobol);
        for dimension in &mut dimensions {
            *dimension = owen_scramble(*dimension, evolve(&mut self.seed));
        }
        dimensions.map(|bits| f64::from(bits >> 8) * 5.960_464_477_54e-8)
    }
}
