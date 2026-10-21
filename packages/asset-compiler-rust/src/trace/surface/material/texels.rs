//! A texture as a traced hit filters it: the levels of its mip chain — the chain's carried tail
//! `texture` already reduced, or the whole chain of the decoded image —, read linear and
//! filtered trilinearly over a sample's footprint, wrapped past its edges as the GPU's sampler
//! wraps it (`hlod/flatten/bake/gpu/shade.wgsl`), so the CPU and the GPU read the same texels.
use super::Across;
use crate::texture::{preview_last_level, preview_level_size, AtlasKind, TexturePreview};

/// How a sampler wraps a texture coordinate past the texture's edge along one axis, as the GPU
/// reads it (`hlod/flatten/bake/gpu/shade.wgsl`'s `folded` and `wrap`): again from the start, glTF's
/// default; clamped to the edge texel; read back and forth.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Wrap {
    Repeat,
    Clamp,
    Mirror,
}

impl Wrap {
    /// Coordinate `x` brought within the stretch that reads the same texels: the texture itself
    /// when clamped, two turns when mirrored — a coordinate that is not finite reads as zero there
    /// —, as it is when repeated, whose texels wrap (`texel`).
    fn within(self, x: f64) -> f64 {
        match self {
            Self::Repeat => x,
            _ if !x.is_finite() => 0.0,
            Self::Clamp => x.clamp(0.0, 1.0),
            Self::Mirror => x - 2.0 * (0.5 * x).floor(),
        }
    }

    /// Texel `x` of a row `size` texels long: the edge texel past either end when clamped, the row
    /// read back and forth when mirrored, again from its start when repeated.
    fn texel(self, x: i64, size: i64) -> i64 {
        match self {
            Self::Repeat => x.rem_euclid(size),
            Self::Clamp => x.clamp(0, size - 1),
            Self::Mirror => {
                let turn = x.rem_euclid(2 * size);
                if turn >= size {
                    2 * size - 1 - turn
                } else {
                    turn
                }
            }
        }
    }
}

/// One texture's levels, finest first, each half the one before, RGBA8 as the chain holds them,
/// read linear — a colour atlas's colours from sRGB —: filtered trilinearly with repeat, as the GPU
/// reads a texture, bilinear in the two levels around the footprint's, blended.
pub(crate) struct Texels {
    /// Each level's width, height and RGBA8 texels.
    levels: Vec<(usize, usize, Vec<u8>)>,
    /// Whether the three colours read through sRGB's curve (`texture::srgb_table`), every other
    /// byte on the unit interval (`texture::linear_table`).
    srgb: bool,
}
impl Texels {
    /// The finest carried level of `texture`'s chain in `atlas`, when the stage baked one. A
    /// texture read by several materials has one chain each kind: with `coverage`, a coverage
    /// chain comes first, since its reduced levels keep level 0's coverage and a plain one's
    /// do not.
    pub(super) fn of(
        previews: &[TexturePreview],
        texture: Option<u64>,
        atlas: AtlasKind,
        coverage: bool,
    ) -> Option<Self> {
        let chains = previews
            .iter()
            .filter(|p| Some(u64::from(p.texture)) == texture && p.kind.atlas() == atlas);
        let preview =
            chains.min_by_key(|p| !(coverage && matches!(p.kind, AtlasKind::Coverage(_))))?;
        let last = preview_last_level(preview.width, preview.height);
        let mut from = 0;
        let levels: Vec<(usize, usize, Vec<u8>)> = (preview.first_level..=last)
            .map_while(|level| {
                let (w, h) = preview_level_size(preview.width, preview.height, level);
                let (w, h) = (w as usize, h as usize);
                let pixels = preview.pixels.get(from..from + w * h * 4)?.to_vec();
                from += w * h * 4;
                Some((w, h, pixels))
            })
            .collect();
        (!levels.is_empty()).then(|| Self::new(levels, atlas == AtlasKind::Color))
    }

    /// Levels of RGBA8 texels, read linear, a colour atlas's colours from sRGB.
    pub fn new(levels: Vec<(usize, usize, Vec<u8>)>, srgb: bool) -> Self {
        Self { levels, srgb }
    }

    /// The table channel `c`'s bytes read through.
    fn decode(&self, c: usize) -> &'static [f32; 256] {
        if self.srgb && c < 3 {
            crate::texture::srgb_table()
        } else {
            crate::texture::linear_table()
        }
    }

    /// Each level's width, height and RGBA8 texels, finest first: what the GPU bake filters
    /// (`hlod/flatten/bake/gpu`).
    pub fn levels(&self) -> &[(usize, usize, Vec<u8>)] {
        &self.levels
    }

    /// Whether the three colours read through sRGB's curve.
    pub fn srgb(&self) -> bool {
        self.srgb
    }

    /// The texture at `uv` filtered over the footprint `across`, linear RGBA in `[0, 1]`: the level
    /// whose texel the footprint's longer side spans, between two levels blended, repeated past
    /// its edges.
    pub fn sample(&self, uv: [f64; 2], across: Across) -> [f64; 4] {
        self.sample_wrapped(uv, across, [Wrap::Repeat; 2])
    }

    /// `sample`, the texture wrapped past its edges along `u` and `v` as `wraps` names.
    pub fn sample_wrapped(&self, uv: [f64; 2], across: Across, wraps: [Wrap; 2]) -> [f64; 4] {
        let (width, height, _) = self.levels[0];
        let spans = across.map(|[du, dv]| (du * width as f64).hypot(dv * height as f64));
        let last = (self.levels.len() - 1) as f64;
        let lod = spans[0].max(spans[1]).max(1.0).log2().min(last);
        let (level, blend) = (lod.floor() as usize, lod.fract());
        let fine = self.bilinear(level, uv, wraps);
        if blend == 0.0 {
            return fine;
        }
        let coarse = self.bilinear(level + 1, uv, wraps);
        std::array::from_fn(|c| fine[c] + (coarse[c] - fine[c]) * blend)
    }

    /// Level `level` at `uv`, bilinear between its four nearest texels, wrapped as `wraps` names.
    fn bilinear(&self, level: usize, uv: [f64; 2], wraps: [Wrap; 2]) -> [f64; 4] {
        let (width, height, pixels) = &self.levels[level];
        let (w, h) = (*width as i64, *height as i64);
        let decode = [0, 1, 2, 3].map(|c| self.decode(c));
        let value = |x: i64, y: i64, c: usize| {
            let at = (wraps[1].texel(y, h) * w + wraps[0].texel(x, w)) as usize * 4 + c;
            f64::from(decode[c][pixels[at] as usize])
        };
        let uv = [wraps[0].within(uv[0]), wraps[1].within(uv[1])];
        let (x, y) = (uv[0] * w as f64 - 0.5, uv[1] * h as f64 - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let (x0, y0) = (x0 as i64, y0 as i64);
        std::array::from_fn(|c| {
            let row = |y| value(x0, y, c) * (1.0 - fx) + value(x0.wrapping_add(1), y, c) * fx;
            row(y0) * (1.0 - fy) + row(y0.wrapping_add(1)) * fy
        })
    }
}
