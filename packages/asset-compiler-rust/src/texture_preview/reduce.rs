use super::curves::{linear_to_srgb, srgb_table};
use super::*;

/// What the atlas layer does with the bytes, and therefore what reduction must do
/// with the same: the colour atlas is `rgba8unorm-srgb`, its first three channels
/// go through the sRGB curve; the data atlas is `rgba8unorm`, everything there is
/// linear. Alpha goes through no curve in either case — that is how WebGPU defines
/// these formats.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum AtlasKind {
    Color,
    Data,
}
impl AtlasKind {
    pub fn word(self) -> u32 {
        match self {
            Self::Color => 0,
            Self::Data => 1,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Color => "srgb",
            Self::Data => "linear",
        }
    }
}

/// The ENTIRE mip chain of a source, level 0 included: `levels[k]` is level `k` in
/// RGBA8, at `preview_level_size` dimensions.
///
/// The rule is the one the engine applied on the GPU by regenerating the chain
/// after full resolution (`packages/sdk-browser/textureMips.ts`), reproduced here
/// so baking levels instead of regenerating them does not change the image: each
/// level is computed from the PREVIOUS level already quantised to bytes, never
/// from a kept float; colours are the mean of the four texels, decoded then
/// re-encoded by the atlas curve; alpha is the MEDIAN of the four, the mean of
/// the two middle values, which keeps a cutout-threshold coverage from one level
/// to the next; an odd side repeats its last texel, like `min(p + 1, hi)` in the
/// shader. Neither premultiplication nor a curve declared by the file: the atlas
/// does not know them, and the pyramid follows display, not the file.
pub(super) fn chain(source: &image::RgbaImage, kind: AtlasKind) -> Vec<Vec<u8>> {
    let (width, height) = (source.width(), source.height());
    let last = preview_last_level(width, height);
    let mut levels = Vec::with_capacity(last as usize + 1);
    levels.push(source.as_raw().clone());
    let mut size = (width, height);
    for level in 1..=last {
        let next = preview_level_size(width, height, level);
        let previous = levels.last().expect("previous level");
        levels.push(halve(previous, size, next, kind));
        size = next;
    }
    levels
}

/// Tail the sidecar carries: levels from `preview_first_level` on, end to end.
pub(super) fn tail(levels: &[Vec<u8>], first: u32) -> Vec<u8> {
    levels[first as usize..].concat()
}

/// Table that brings a byte of the previous level back to the value the GPU
/// averages: the sRGB curve for colours of a colour atlas, division by 255 everywhere else.
fn decode_table(kind: AtlasKind) -> &'static [f32; 256] {
    match kind {
        AtlasKind::Color => srgb_table(),
        AtlasKind::Data => super::curves::linear_table(),
    }
}

fn encode(value: f32, kind: AtlasKind) -> u8 {
    match kind {
        AtlasKind::Color => linear_to_srgb(value),
        AtlasKind::Data => (value.clamp(0.0, 1.0) * 255.0).round() as u8,
    }
}

/// Next level from the previous bytes. `(u + v) / 2` is the median of four
/// values: `u` the second and `v` the third once sorted, six comparisons without a sort.
fn halve(previous: &[u8], size: (u32, u32), next: (u32, u32), kind: AtlasKind) -> Vec<u8> {
    let table = decode_table(kind);
    let (width, height) = (size.0 as usize, size.1 as usize);
    let (columns, rows) = (next.0 as usize, next.1 as usize);
    let mut out = Vec::with_capacity(columns * rows * 4);
    for row in 0..rows {
        let y0 = (row * 2).min(height - 1);
        let y1 = (row * 2 + 1).min(height - 1);
        for column in 0..columns {
            let x0 = (column * 2).min(width - 1);
            let x1 = (column * 2 + 1).min(width - 1);
            let at = |x: usize, y: usize| (y * width + x) * 4;
            let texels = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
            for channel in 0..3 {
                let mean = texels
                    .iter()
                    .map(|&t| table[previous[t + channel] as usize])
                    .sum::<f32>()
                    * 0.25;
                out.push(encode(mean, kind));
            }
            let a: [f32; 4] = std::array::from_fn(|i| f32::from(previous[texels[i] + 3]) / 255.0);
            let u = a[0].max(a[1]).min(a[2].max(a[3]));
            let v = a[0].min(a[1]).max(a[2].min(a[3]));
            out.push(((u + v) * 0.5 * 255.0).round() as u8);
        }
    }
    out
}
