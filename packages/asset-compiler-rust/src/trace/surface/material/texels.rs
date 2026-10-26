//! A texture as a traced hit filters it: the levels of its mip chain — the chain's carried tail
//! `texture` already reduced, or the whole chain of the decoded image —, read linear and
//! filtered trilinearly over a sample's footprint, repeated past its edges, as glTF's sampler
//! repeats by default (the atlas bakes read each texture on the GPU, wrapped as its sampler wraps
//! it: `hlod/flatten/bake/gpu/texture.wgsl`).
use super::Across;
use crate::texture::{preview_last_level, preview_level_size, AtlasKind, TexturePreview};

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
    /// The finest carried level of `texture`'s chain in `atlas`, when the stage baked one.
    pub(super) fn of(
        previews: &[TexturePreview],
        texture: Option<u64>,
        atlas: AtlasKind,
    ) -> Option<Self> {
        let preview = previews
            .iter()
            .find(|p| Some(u64::from(p.texture)) == texture && p.kind == atlas)?;
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
        let (width, height, _) = self.levels[0];
        let spans = across.map(|[du, dv]| (du * width as f64).hypot(dv * height as f64));
        let last = (self.levels.len() - 1) as f64;
        let lod = spans[0].max(spans[1]).max(1.0).log2().min(last);
        let (level, blend) = (lod.floor() as usize, lod.fract());
        let fine = self.bilinear(level, uv);
        if blend == 0.0 {
            return fine;
        }
        let coarse = self.bilinear(level + 1, uv);
        std::array::from_fn(|c| fine[c] + (coarse[c] - fine[c]) * blend)
    }

    /// Level `level` at `uv`, bilinear between its four nearest texels, repeated past its edges.
    fn bilinear(&self, level: usize, uv: [f64; 2]) -> [f64; 4] {
        let (width, height, pixels) = &self.levels[level];
        let (w, h) = (*width as i64, *height as i64);
        let decode = [0, 1, 2, 3].map(|c| self.decode(c));
        let value = |x: i64, y: i64, c: usize| {
            let at = (y.rem_euclid(h) * w + x.rem_euclid(w)) as usize * 4 + c;
            f64::from(decode[c][pixels[at] as usize])
        };
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
