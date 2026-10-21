//! One row of the grid read from the sources (`Reader::row`): the fine grid's band under it laid
//! out (`raster`), each of its texels paired with the sources (`rays`), each texel of the row then
//! gathered from its block of fine texels, row after row (`gather`) — its base colour, its
//! coverage, its normal, its specular, roughness and metallic, and its emission where the layer
//! bakes them, each fine texel reading them as `read` says —, and whether a triangle maps to any
//! of its fine texels.
//!
//! A fine texel no source answers reads the layer's unresolved colour as its base colour, zero as
//! its coverage, specular, roughness, metallic and emission, and no normal. A source's coverage is
//! the linear value of its base image's alpha byte read as an sRGB one, its specular, roughness
//! and metallic those of its metal-roughness map's red, green and blue bytes, its emission its
//! emission map's colour, linear.
use super::colour::{grey, linear, Linear};
use super::raster::{Raster, Texel};
use super::rays::{Answer, Rays};
use super::{gather, read, Flattened, Frames};
use crate::hlod::flatten::bake::{Coverage, Maps};
use crate::hlod::flatten::merge::Image;
use crate::hlod::flatten::simplify::kdop::Walk;

/// What a row reads: the pairing, the sources' flattened materials, the fine grid, the grid's own
/// texels and side, the maps the layer bakes, the base colour of a texel no source answers and
/// the mesh's frames.
pub(super) struct Reader<'a> {
    pub rays: Rays<'a>,
    pub flattened: &'a [Flattened],
    pub fine: &'a Raster,
    pub texels: &'a [Texel],
    pub side: usize,
    pub maps: Maps,
    pub unresolved: Linear,
    pub frames: Frames<'a>,
}

/// A row of the grid's values, texel by texel: base colour, and coverage, normal, specular with
/// roughness and metallic, and emission where baked, and whether a triangle maps to one of its
/// fine texels.
#[derive(Default)]
pub(super) struct Row {
    pub base: Vec<Linear>,
    pub coverage: Vec<[f32; 1]>,
    pub normal: Vec<Linear>,
    pub metal: Vec<[f32; 3]>,
    pub emission: Vec<Linear>,
    pub valid: Vec<bool>,
}

/// A flattened material's base colour image.
fn base_image(f: &Flattened) -> Option<&Image> {
    Some(&f.base)
}

/// A flattened material's metal-roughness image, where it bakes one.
fn metal_rough_image(f: &Flattened) -> Option<&Image> {
    f.metal_rough.as_ref()
}

/// A flattened material's emission image, where it bakes one.
fn emission_image(f: &Flattened) -> Option<&Image> {
    f.emission.as_ref()
}

impl Reader<'_> {
    /// What the fine texel answered `answer` reads as a coverage.
    fn coverage(&self, answer: &Answer) -> [f32; 1] {
        let both = (self.rays.sources, self.flattened);
        let alpha = |t: [u8; 4]| [grey(t[3])];
        read::colour(answer, both, [0.0], (base_image, alpha))
    }

    /// What the fine texel answered `answer` reads as a specular, a roughness and a metallic.
    fn metal(&self, answer: &Answer) -> [f32; 3] {
        let both = (self.rays.sources, self.flattened);
        let channels = |t: [u8; 4]| [grey(t[0]), grey(t[1]), grey(t[2])];
        read::colour(answer, both, [0.0; 3], (metal_rough_image, channels))
    }

    /// What the fine texel answered `answer` reads as an emission.
    fn emission(&self, answer: &Answer) -> Linear {
        let both = (self.rays.sources, self.flattened);
        read::colour(answer, both, [0.0; 4], (emission_image, linear))
    }

    /// Row `y` of the grid (module doc), `walk` the tree's scratch.
    pub(super) fn row(&self, y: usize, walk: &mut Walk) -> Row {
        let band = self.fine.band(y);
        let answers: Vec<Answer> = band.iter().map(|t| self.rays.answer(t, walk)).collect();
        let (samples, width) = (self.fine.rows, self.fine.width);
        let both = (self.rays.sources, self.flattened);
        let mut row = Row::default();
        for x in 0..self.side {
            let columns = x * samples..(x + 1) * samples;
            let block = || (0..samples).flat_map(|r| columns.clone().map(move |c| r * width + c));
            row.valid.push(block().any(|k| band[k].triangle > -1));
            let base =
                |k: usize| read::colour(&answers[k], both, self.unresolved, (base_image, linear));
            row.base.push(gather::base(block().map(base)));
            if self.maps.coverage() != Coverage::Opaque {
                let samples = block().map(|k| self.coverage(&answers[k]));
                row.coverage.push(gather::mean(samples));
            }
            if self.maps.normal {
                let texel = &self.texels[y * self.side + x];
                let normals = block().map(|k| read::normal(&answers[k], both));
                let frames = (self.rays.proxy, &self.frames);
                row.normal.push(gather::normal(texel, frames, normals));
            }
            if self.maps.metal_rough() {
                let samples = block().map(|k| self.metal(&answers[k]));
                row.metal.push(gather::mean(samples));
            }
            if self.maps.emissive {
                let samples = block().map(|k| self.emission(&answers[k]));
                row.emission.push(gather::mean(samples));
            }
        }
        row
    }
}
