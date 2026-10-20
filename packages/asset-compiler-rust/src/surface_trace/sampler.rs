//! One sample of a traced surface from several rays: colour and coverage, normal and depth, ORM,
//! averaged over what the rays hit — four rays, sixteen where they disagree (`texel`). The voxel
//! faces sample through it (`voxel::sample`); the HLOD atlases cast their rays by the same rule
//! (`rays`, `parted`).
use super::mesh::Sample;
use trillion3d_math::scalar::unit_to_byte;
use trillion3d_math::vec3::normalized_or;
use trillion3d_math::{scalar, vecn};

/// A texel's rays, in 64ths of it from its top-left corner, each at the middle of its 64th: the
/// first 16 points of the two-dimensional Sobol sequence, their digits flipped by `SCRAMBLE`. Each
/// prefix of 4ᵐ is a (0, 2m, 2)-net — every column and every row of 4ᵐths, every cell of the
/// grids of 4ᵐ cells over the texel holds one ray, so no thin part a 4ᵐth wide or more, nor any
/// regular pitch of them, slips between them all —, its mean within 1.5/64 of the texel's centre
/// once flipped. Fixed, so a rebuild samples the same bytes. A voxel's rays cross its faces at
/// them (`voxel::sample`).
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

/// A texel from the kept samples of its `rays`: colour, normal, depth and ORM averaged over the
/// hits alone — the colour straight, beside its coverage, so an edge is not darkened; the depth
/// the mean height —, coverage the share of rays that hit.
fn resolve(hits: &[Sample], rays: usize, radius: f64) -> [[u8; 4]; 3] {
    let coverage = unit_to_byte(hits.len() as f64 / rays as f64);
    if hits.is_empty() {
        return [[0; 4]; 3];
    }
    let mean = |f: &dyn Fn(&Sample) -> [f64; 3]| vecn::mean(hits.iter().map(f));
    let colour = mean(&|h| h.colour).map(|c| crate::texture_preview::linear_to_srgb(c as f32));
    let normal =
        normalized_or(mean(&|h| h.normal), [0.0, 1.0, 0.0]).map(|n| unit_to_byte(n * 0.5 + 0.5));
    // `D = ½ + height / 2R`, the height `2R − distance` above the frame plane.
    let distance = scalar::mean(hits.iter().map(|h| h.distance));
    let depth = unit_to_byte(1.5 - distance / (2.0 * radius));
    let orm = mean(&|h| h.orm).map(unit_to_byte);
    [
        [colour[0], colour[1], colour[2], coverage],
        [normal[0], normal[1], normal[2], depth],
        [orm[0], orm[1], orm[2], 255],
    ]
}

/// A texel from its rays, `trace(k)` ray `k`'s kept sample: each prefix of `LEVELS` in turn, the
/// next when its rays' texels part by more than `SPREAD`, or, after the first, when `thin(depth)`
/// finds a part thin enough to slip between its rays that may come nearer than `depth`, the
/// farthest of their hits — infinite when one misses.
pub(crate) fn texel(
    radius: f64,
    trace: impl Fn(usize) -> Option<Sample>,
    thin: impl Fn(f64) -> bool,
) -> [[u8; 4]; 3] {
    let samples = rays(trace, |samples: &[Option<Sample>]| {
        let alone: smallvec::SmallVec<[[u8; 12]; SUBSAMPLES.len()]> = (samples.iter())
            .map(|s| {
                let t = resolve(s.as_slice(), 1, radius);
                std::array::from_fn(|b| t[b / 4][b % 4])
            })
            .collect();
        let depth = || {
            (samples.iter())
                .map(|s| s.as_ref().map_or(f64::INFINITY, |s| s.distance))
                .fold(0.0, f64::max)
        };
        parted(&alone) || samples.len() == LEVELS[0] && thin(depth())
    });
    let rays = samples.len();
    let hits: smallvec::SmallVec<[Sample; SUBSAMPLES.len()]> =
        samples.into_iter().flatten().collect();
    resolve(&hits, rays, radius)
}
