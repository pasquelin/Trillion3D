//! Where an entry's baked texels are written (`Targets`): the images of the entry's own, or those
//! of an atlas the entries share, and what one texel's words make of each map.
use super::super::smear::{Image, BACKGROUND};
use crate::hlod::flatten::bake::gpu::Tile;
use crate::hlod::flatten::bake::{Maps, METALLIC, ROUGHNESS};
use crate::texture::linear_to_srgb;
use trillion3d_math::scalar::unit_to_byte;

/// The images a bake writes its texels into, each `size` texels square, and the entry's emission in
/// linear, per texel, where the layer bakes it (`bake::Maps`). `masked` for an atlas the entries
/// share: a texel whose value is the background's is no texel written, in any image, and an earlier
/// entry's stays.
pub(in crate::hlod) struct Targets<'a> {
    pub base: &'a mut Image,
    pub normal: Option<&'a mut Image>,
    pub metal_rough: Option<&'a mut Image>,
    pub occlusion: Option<&'a mut Image>,
    pub anisotropy: Option<&'a mut Image>,
    pub emitted: Option<&'a mut [[f32; 3]]>,
    pub masked: bool,
}

/// `value` stored at `at` of `image`, unless `masked` and it is the background's.
fn store(image: &mut Image, at: usize, value: [u8; 4], masked: bool) {
    if !(masked && value == BACKGROUND) {
        image.texels[at] = value;
    }
}

impl Targets<'_> {
    /// The texel at `at` made of `tile`'s words, as `maps` bakes it, written in every image; the
    /// emission of `tile` in linear returned where baked.
    pub(in crate::hlod) fn put(&mut self, at: usize, tile: &Tile, maps: Maps) -> Option<[f32; 3]> {
        let masked = self.masked;
        store(self.base, at, tile[0].to_le_bytes(), masked);
        if let Some(image) = self.normal.as_mut() {
            store(image, at, tile[1].to_le_bytes(), masked);
        }
        if let Some(image) = self.metal_rough.as_mut() {
            store(image, at, metal_rough_of(tile[2], maps), masked);
        }
        if let Some(image) = self.occlusion.as_mut() {
            store(image, at, tile[3].to_le_bytes(), masked);
        }
        if let Some(image) = self.anisotropy.as_mut() {
            store(image, at, anisotropy_of(tile[4], maps), masked);
        }
        let emitted = self.emitted.as_mut()?;
        let emission = [tile[5], tile[6], tile[7]].map(f32::from_bits);
        emitted[at] = emission;
        Some(emission)
    }
}

/// The place in an image `size` texels square of a texel `sample` names (`tile::covered`).
pub(super) fn place(sample: [u32; 4], size: usize) -> usize {
    (sample[0] >> 16) as usize * size + (sample[0] & 0xffff) as usize
}

/// The metal-roughness texel a tile's word holds, as `maps` bakes it: the specular where baked,
/// else zero; the roughness and the metallic where baked, else their constants
/// (`bake::ROUGHNESS`, `bake::METALLIC`).
fn metal_rough_of(word: u32, maps: Maps) -> [u8; 4] {
    let [specular, rough, metal, _] = word.to_le_bytes();
    [
        if maps.specular { specular } else { 0 },
        if maps.roughness {
            rough
        } else {
            unit_to_byte(ROUGHNESS)
        },
        if maps.metallic {
            metal
        } else {
            unit_to_byte(METALLIC)
        },
        255,
    ]
}

/// The anisotropy texel a tile's word holds, as `maps` bakes it: the direction in its first two
/// channels, the tangent's — along `u` — where the layer does not bake the tangent, and the
/// strength in its third, zero where it does not bake the anisotropy.
fn anisotropy_of(word: u32, maps: Maps) -> [u8; 4] {
    let [x, y, strength, _] = word.to_le_bytes();
    let [x, y] = match maps.tangent {
        true => [x, y],
        false => [unit_to_byte(1.0), unit_to_byte(0.5)],
    };
    [x, y, if maps.anisotropy { strength } else { 0 }, 255]
}

/// The emission texel `emission` over the `strength` it is held to, opaque, in sRGB: black where
/// nothing emits.
pub(super) fn held(emission: [f32; 3], strength: f32) -> [u8; 4] {
    let share = if strength > 0.0 { 1.0 / strength } else { 0.0 };
    let [r, g, b] = emission.map(|c| linear_to_srgb(c * share));
    [r, g, b, 255]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(base: [u8; 4]) -> Tile {
        [u32::from_le_bytes(base), 0, 0, 0, 0, 0, 0, 0]
    }

    #[test]
    fn a_masked_target_keeps_the_texel_an_earlier_entry_wrote_where_this_one_wrote_none() {
        let mut base = Image::background(2, 1);
        base.texels[0] = [1, 2, 3, 255];
        let maps = Maps::default();
        let mut targets = Targets {
            base: &mut base,
            normal: None,
            metal_rough: None,
            occlusion: None,
            anisotropy: None,
            emitted: None,
            masked: true,
        };
        // A texel of the background's value writes nothing; another does.
        targets.put(0, &tile(BACKGROUND), maps);
        targets.put(1, &tile([9, 9, 9, 255]), maps);
        assert_eq!(base.texels, [[1, 2, 3, 255], [9, 9, 9, 255]]);
        // Unmasked, the background's value is written like any other.
        let mut own = Image::background(1, 1);
        own.texels[0] = [1, 2, 3, 255];
        let mut targets = Targets {
            base: &mut own,
            normal: None,
            metal_rough: None,
            occlusion: None,
            anisotropy: None,
            emitted: None,
            masked: false,
        };
        targets.put(0, &tile(BACKGROUND), maps);
        assert_eq!(own.texels[0], BACKGROUND);
    }
}
