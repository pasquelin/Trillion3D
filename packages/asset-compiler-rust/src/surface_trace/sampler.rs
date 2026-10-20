//! The rays of one sample of a traced surface: four, sixteen where they disagree (`rays`,
//! `parted`), at the points of a fixed net (`SUBSAMPLES`); the HLOD atlases cast their rays by
//! this rule.

/// A texel's rays, in 64ths of it from its top-left corner, each at the middle of its 64th: the
/// first 16 points of the two-dimensional Sobol sequence, their digits flipped by `SCRAMBLE`. Each
/// prefix of 4ᵐ is a (0, 2m, 2)-net — every column and every row of 4ᵐths, every cell of the
/// grids of 4ᵐ cells over the texel holds one ray, so no thin part a 4ᵐth wide or more, nor any
/// regular pitch of them, slips between them all —, its mean within 1.5/64 of the texel's centre
/// once flipped. Fixed, so a rebuild samples the same bytes.
pub(crate) const SUBSAMPLES: [[f64; 2]; 16] = {
    // The second dimension's first four direction numbers, in 64ths.
    const DIRECTIONS: [usize; 4] = [32, 48, 40, 60];
    const SCRAMBLE: usize = 6;
    let mut out = [[0.0; 2]; 16];
    let mut k = 0;
    while k < 16 {
        let (mut x, mut y, mut bit) = (0, 0, 0);
        while bit < 4 {
            if k >> bit & 1 == 1 {
                x |= 32 >> bit;
                y ^= DIRECTIONS[bit];
            }
            bit += 1;
        }
        out[k] = [
            ((x ^ SCRAMBLE) as f64 + 0.5) / 64.0,
            ((y ^ SCRAMBLE) as f64 + 0.5) / 64.0,
        ];
        k += 1;
    }
    out
};

/// The prefixes of `SUBSAMPLES` a texel casts, each the next when the one before disagrees.
const LEVELS: [usize; 2] = [4, 16];

/// The most two of a prefix's rays' texels, each resolved alone, may part by in any byte of the
/// maps before the texel casts the next: a hit beside a miss, another surface, a turn of the
/// normal or the depth.
const SPREAD: u8 = 2;

/// Whether two of the bytes `alone` — each ray's texel resolved alone — part by more than
/// `SPREAD` in any byte: the prefix may resolve to other bytes than the next would.
pub(crate) fn parted<const N: usize>(alone: &[[u8; N]]) -> bool {
    (0..N).any(|b| {
        let bytes = alone.iter().map(|t| t[b]);
        bytes.clone().max().unwrap_or(0) - bytes.min().unwrap_or(0) > SPREAD
    })
}

/// A texel's kept samples, held in place: no allocation per texel.
pub(crate) type Samples<S> = smallvec::SmallVec<[Option<S>; SUBSAMPLES.len()]>;

/// The kept samples of a texel's rays, `trace(k)` ray `k`'s: each prefix of `LEVELS` in turn, the
/// next only when `more(samples)` finds the prefix may resolve to other bytes.
pub(crate) fn rays<S>(
    trace: impl Fn(usize) -> Option<S>,
    more: impl Fn(&[Option<S>]) -> bool,
) -> Samples<S> {
    let mut samples: Samples<S> = Samples::new();
    for (level, &count) in LEVELS.iter().enumerate() {
        samples.extend((samples.len()..count).map(&trace));
        if level + 1 == LEVELS.len() || !more(&samples) {
            break;
        }
    }
    samples
}
