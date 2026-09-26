//! Coverage-preserving alpha: the rule every builder of a coverage chain applies
//! after the median of four — this compiler, and the card's WebGPU and WebGL2
//! chains once they mirror it step for step (#748; until then a hosted texture
//! the card regenerates keeps the median alone).
//!
//! A masked material keeps a texel when its alpha, times the material's
//! `baseColorFactor` alpha, reaches the cutoff (`alpha >= alphaTest`), and the median of four does not keep the share of
//! texels that do: on foliage the coarse levels thin out (sponza's masked maps
//! lose up to 57 % of their coverage at level 8, #44). So, at every level `k ≥ 1`
//! of a coverage chain whose cutoff byte `C` is not 0 (`cutoff_byte`):
//!
//! 1. the level is reduced as any other — colours, then the median alpha;
//! 2. `n0` counts level 0's texels whose alpha is `≥ C`, `N0` and `Nk` are the
//!    texel counts of levels 0 and `k`, and `above(t)` counts level `k`'s texels
//!    whose median alpha is `≥ t` (a 256-bin histogram);
//! 3. `t` is the byte of `1..=255` that minimises `|above(t) × N0 − n0 × Nk|` —
//!    level 0's share, never the previous level's, so no error carries over —, a
//!    tie going to the `t` nearest `C`, then to the lower one;
//! 4. every alpha `a` of level `k` becomes `a × s` rounded half up, with
//!    `s = (C − 0.5) / (t − 0.5)`, computed in integers so that every builder
//!    lands on the same byte: `min(255, (2a(2C − 1) + 2t − 1) / (4t − 2))`, the
//!    division truncating. Every `a ≥ t` lands at or above `C`, every `a < t`
//!    below it: exactly `above(t)` texels pass. `t = C` leaves the level as it is.
//!
//! Level `k + 1` is reduced from these bytes. Colours are not touched. A chain
//! whose cutoff is 0 — every reader blends — keeps the median alone.

use super::reduce::AtlasKind;

/// The smallest byte a masked material keeps at `cutoff` (`b / 255 >= cutoff`,
/// the engine's test on the sampled alpha), for a cutoff above 0 as every
/// coverage reader's is; 0 — no scaling — when no byte reaches it, since such a
/// material keeps no texel at any level.
pub(super) fn cutoff_byte(cutoff: f32) -> u8 {
    (1..=255u8)
        .find(|&byte| f32::from(byte) / 255.0 >= cutoff)
        .unwrap_or(0)
}

/// The cutoff two coverage readers share: the lower one that cuts, 0 only when
/// neither does — a blended reader, or one that keeps no texel, cuts nothing.
pub(super) fn lowest_cutoff(a: u8, b: u8) -> u8 {
    match (a, b) {
        (0, cut) | (cut, 0) => cut,
        _ => a.min(b),
    }
}

/// What level 0 covers at the chain's cutoff: the share every level keeps.
pub(super) struct Covered {
    cutoff: u8,
    covered: u64,
    texels: u64,
}

impl Covered {
    /// Level 0's count at the cutoff of a `Coverage` chain that has one; `None`
    /// for every other chain, which keeps the median alone.
    pub(super) fn of(level0: &[u8], kind: AtlasKind) -> Option<Self> {
        let AtlasKind::Coverage(cutoff @ 1..) = kind else {
            return None;
        };
        let (texels, _) = level0.as_chunks::<4>();
        Some(Self {
            cutoff,
            covered: texels.iter().filter(|texel| texel[3] >= cutoff).count() as u64,
            texels: texels.len() as u64,
        })
    }

    /// Scales the median alpha of `level` (RGBA8) so that its share of texels at
    /// or above the cutoff is level 0's, steps 2 to 4 of the module's rule.
    pub(super) fn preserve(&self, level: &mut [u8]) {
        let mut histogram = [0u64; 256];
        for texel in level.as_chunks::<4>().0 {
            histogram[usize::from(texel[3])] += 1;
        }
        let t = u32::from(self.pick(&histogram, (level.len() / 4) as u64));
        let c = u32::from(self.cutoff);
        if t == c {
            return;
        }
        let scaled: [u8; 256] = std::array::from_fn(|a| {
            ((2 * a as u32 * (2 * c - 1) + 2 * t - 1) / (4 * t - 2)).min(255) as u8
        });
        for texel in level.as_chunks_mut::<4>().0 {
            texel[3] = scaled[usize::from(texel[3])];
        }
    }

    /// Step 3: the byte whose count of texels at or above it best matches level
    /// 0's share, ties to the one nearest the cutoff, then to the lower one.
    fn pick(&self, histogram: &[u64; 256], texels: u64) -> u8 {
        let target = self.covered * texels;
        let mut above = 0u64;
        let mut best = (u64::MAX, u8::MAX, self.cutoff);
        for t in (1..=255u8).rev() {
            above += histogram[usize::from(t)];
            let error = (above * self.texels).abs_diff(target);
            best = best.min((error, t.abs_diff(self.cutoff), t));
        }
        best.2
    }
}
