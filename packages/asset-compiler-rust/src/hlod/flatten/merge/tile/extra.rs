//! The maps of a merged entry's texel beyond the base colour, the normal and the roughness and
//! metallic (`bake::Maps`), each read from the texel's source triangle over the footprint carried
//! onto it, as the GPU bake reads them (`bake/gpu/shade.wgsl`):
//! - the base colour's alpha, the material's opacity — a blended source's — or its mask — a masked
//!   source's —, one where the source is neither (`Texel::coverage`);
//! - the specular, the input times its map's alpha (`Texel::specular`);
//! - the emission, the factor times its map's colour (`Texel::emission`);
//! - the occlusion, glTF's: `1 + strength · (red − 1)` of the map's red channel
//!   (`Texel::occlusion`);
//! - the anisotropy, `KHR_materials_anisotropy`'s: the strength times the map's blue channel and
//!   the direction — the map's red and green, or the x axis, turned by the rotation
//!   (`Texel::anisotropy`).
use super::shade::wraps;
use super::Steps;
use crate::hlod::flatten::bake::sources::Sources;
use crate::hlod::flatten::bake::{Coverage, Maps};
use crate::texture::linear_to_srgb;
use crate::trace::surface::material::{
    Texels, ANISOTROPY_SLOT, EMISSION_SLOT, OCCLUSION_SLOT, SPECULAR_SLOT,
};
use std::sync::Arc;
use trillion3d_math::scalar::unit_to_byte;

/// The triangle `t` of `sources` a texel reads, at barycentric `at`, its footprint's `steps`.
pub(super) struct Texel<'a> {
    pub sources: &'a Sources,
    pub t: usize,
    pub at: [f64; 2],
    pub steps: Steps,
}

impl Texel<'_> {
    /// `texture`, the map of surface slot `slot` that the bake wraps as its slot `wrap` says,
    /// sampled at the texel: its four channels; `None` for a surface without the map.
    fn read(&self, texture: &Option<Arc<Texels>>, (slot, wrap): (usize, u32)) -> Option<[f64; 4]> {
        let texels = texture.as_ref()?;
        let traced = &self.sources.mesh;
        let word = self.sources.wraps[traced.world.tags[self.t] as usize];
        let (uv, across) = traced.uv(self.t, self.at, slot, self.steps);
        Some(texels.sample_wrapped(uv, across, wraps(word, wrap)))
    }

    /// The base colour's alpha as `kind` reads it, on `[0, 1]`: the source's own — its factor, its
    /// texture's alpha and its vertex colour's — where it is drawn blended and `kind` is the
    /// opacity, or drawn masked and `kind` is the mask; one otherwise.
    pub fn coverage(&self, kind: Coverage) -> f64 {
        let traced = &self.sources.mesh;
        let surface = traced.surface(self.t);
        let masked = surface.cut.is_some() && !surface.blend;
        let own = match kind {
            Coverage::Blend => surface.blend,
            Coverage::Mask => masked,
            Coverage::Opaque => false,
        };
        if !own {
            return 1.0;
        }
        let tint = traced.vertex_colour(self.t, self.at)[3];
        let texel = self.read(&surface.colour, (0, 0)).map_or(1.0, |x| x[3]);
        (surface.factor[3] * tint * texel).clamp(0.0, 1.0)
    }

    /// The specular: the surface's input times its map's alpha.
    pub fn specular(&self) -> f64 {
        let surface = self.sources.mesh.surface(self.t);
        let map = self.read(&surface.specular_map, (SPECULAR_SLOT, 4));
        surface.specular * map.map_or(1.0, |x| x[3])
    }

    /// The emission, linear: the surface's factor times its map's colour.
    pub fn emission(&self) -> [f64; 3] {
        let surface = self.sources.mesh.surface(self.t);
        let map = self.read(&surface.emission_map, (EMISSION_SLOT, 3));
        [0, 1, 2].map(|c| surface.emission[c] * map.map_or(1.0, |x| x[c]))
    }

    /// The occlusion on `[0, 1]`: one where the surface has no map, else the map's red brought
    /// towards one by the strength, `1 + strength · (red − 1)`.
    pub fn occlusion(&self) -> f64 {
        let surface = self.sources.mesh.surface(self.t);
        let map = self.read(&surface.occlusion, (OCCLUSION_SLOT, 5));
        map.map_or(1.0, |x| 1.0 + surface.occlusion_strength * (x[0] - 1.0))
            .clamp(0.0, 1.0)
    }

    /// The anisotropy: the unit direction in the tangent plane and the strength on `[0, 1]`. The
    /// direction is the map's red and green on `[-1, 1]`, or the tangent where the surface has no
    /// map, turned by the rotation, counter-clockwise; the strength the surface's times the map's
    /// blue.
    pub fn anisotropy(&self) -> ([f64; 2], f64) {
        let surface = self.sources.mesh.surface(self.t);
        let map = self.read(&surface.anisotropy_map, (ANISOTROPY_SLOT, 6));
        let strength = surface.anisotropy * map.map_or(1.0, |x| x[2]);
        let [x, y] = map.map_or([1.0, 0.0], |m| [m[0] * 2.0 - 1.0, m[1] * 2.0 - 1.0]);
        let length = x.hypot(y);
        let [x, y] = if length > 1e-9 {
            [x / length, y / length]
        } else {
            [1.0, 0.0]
        };
        let (sin, cos) = surface.anisotropy_rotation.sin_cos();
        (
            [x * cos - y * sin, x * sin + y * cos],
            strength.clamp(0.0, 1.0),
        )
    }
}

/// What a covered texel holds of the maps no merged atlas bakes by default (`more`): its emission
/// as the source gives it, linear, which an entry's strength later brings onto the unit interval
/// (`baked`); its occlusion and anisotropy images' texels.
pub(super) struct More {
    pub emission: [f32; 3],
    pub occlusion: [u8; 4],
    pub anisotropy: [u8; 4],
}

/// A value on `[-1, 1]` as the unit interval's byte, the way a normal map holds a direction.
fn signed_byte(x: f64) -> u8 {
    unit_to_byte(x * 0.5 + 0.5)
}

/// The texel's maps beyond the default ones `maps` bakes: the emission; the occlusion in the
/// first channel of its image; the anisotropy's direction in its first two channels and strength
/// in its third, a strength not baked zero and a direction not baked the tangent's, as the
/// constants the maps take where a material bakes none.
pub(super) fn more(texel: &Texel, maps: Maps) -> More {
    let emission = match maps.emissive {
        true => texel.emission().map(|c| c as f32),
        false => [0.0; 3],
    };
    let occlusion = match maps.occlusion {
        true => [unit_to_byte(texel.occlusion()), 0, 0, 255],
        false => [0; 4],
    };
    let anisotropy = match maps.anisotropic() {
        false => [0; 4],
        true => {
            let (direction, strength) = texel.anisotropy();
            let [x, y] = match maps.tangent {
                true => direction,
                false => [1.0, 0.0],
            };
            let strength = if maps.anisotropy { strength } else { 0.0 };
            [signed_byte(x), signed_byte(y), unit_to_byte(strength), 255]
        }
    };
    More {
        emission,
        occlusion,
        anisotropy,
    }
}

/// The emission texel `emission` over the `strength` it is held to, opaque, in sRGB: black where
/// nothing emits.
pub(super) fn held(emission: [f32; 3], strength: f32) -> [u8; 4] {
    let scale = if strength > 0.0 { 1.0 / strength } else { 0.0 };
    let [r, g, b] = emission.map(|c| linear_to_srgb(c * scale));
    [r, g, b, 255]
}
