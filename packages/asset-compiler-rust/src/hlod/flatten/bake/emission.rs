//! An approximated atlas's emission map (`Maps::emissive`): each texel's emission as the bake reads
//! it — the views' scene colour, half precision (`gpu/capture.wgsl`'s `kept`) —, then held as an
//! RGBA8 image of the emission over its strength in sRGB, the strength the largest channel any
//! sampled texel reads, so a texel's colour times the strength is its emission: an image holds
//! its colours on the unit interval, the material's factor carries the rest
//! (`publish::flattened_material`). The image is filled and averaged down as the base colour is,
//! in linear (`raster::Image::srgb`), which the strength scales alike.
use super::super::uv::raster::SAMPLED;
use crate::texture::linear_to_srgb;

/// The half-precision number of `bits` widened to single precision, exactly: its sign, its
/// exponent rebased, its mantissa shifted; a subnormal scaled from its mantissa; infinity and NaN
/// kept.
fn widened(bits: u16) -> f32 {
    let sign = u32::from(bits >> 15) << 31;
    let exponent = u32::from((bits >> 10) & 0x1f);
    let mantissa = u32::from(bits & 0x3ff);
    match exponent {
        0 => {
            let magnitude = mantissa as f32 * f32::powi(2.0, -24);
            f32::from_bits(sign | magnitude.to_bits())
        }
        31 => f32::from_bits(sign | 0x7f80_0000 | (mantissa << 13)),
        _ => f32::from_bits(sign | ((exponent + 112) << 23) | (mantissa << 13)),
    }
}

/// The three half-precision channels of a texel's emission as the bake returns them: red and
/// green in `pair`'s lower and upper halves, blue in the upper half of `third`.
pub(super) fn halves(pair: u32, third: u32) -> [u16; 3] {
    [pair as u16, (pair >> 16) as u16, (third >> 16) as u16]
}

/// The emission map of `texels`, each texel's channels at half precision (`halves`), and their
/// occupancy: its RGBA8 image, every texel's emission over the strength in sRGB, opaque, and the
/// strength, the largest channel a sampled texel holds — zero, and a black image, where none emits.
pub(super) fn encoded(texels: &[[u16; 3]], occupancy: &[u32]) -> (Vec<u8>, f32) {
    let linear: Vec<[f32; 3]> = texels.iter().map(|t| t.map(widened)).collect();
    let strength = (linear.iter().zip(occupancy))
        .filter(|&(_, &code)| code == SAMPLED)
        .flat_map(|(t, _)| *t)
        .fold(0.0f32, f32::max);
    let scale = if strength > 0.0 { 1.0 / strength } else { 0.0 };
    let image = (linear.iter())
        .flat_map(|t| {
            let [r, g, b] = t.map(|c| linear_to_srgb(c * scale));
            [r, g, b, 255]
        })
        .collect();
    (image, strength)
}
