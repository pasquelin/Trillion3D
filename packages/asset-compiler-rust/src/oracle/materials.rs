use crate::compiler::materials::albedo::Palette;
use crate::texture::source::with_image_bytes;
use serde_json::Value;
use std::path::Path;
use trillion3d_math::color::srgb_byte_to_linear;

/// Mean color of a texture, decoded right here. Oracle does not read the cache preview: it
/// recomputes the average on the source image, embedded or linked, so both paths verify each other.
fn texture_mean(g: &Value, bin: &[u8], directory: &Path, texture: u64) -> Option<[f64; 3]> {
    let image = g
        .get("textures")
        .and_then(Value::as_array)?
        .get(texture as usize)?
        .get("source")
        .and_then(Value::as_u64)?;
    let image = g
        .get("images")
        .and_then(Value::as_array)?
        .get(image as usize)?;
    let decoded = with_image_bytes(g, bin, directory, image, |bytes, _| {
        image::load_from_memory(bytes).map_err(|_| "image-undecodable")
    })
    .ok()?
    .to_rgb8();
    let mut sum = [0.0f64; 3];
    for pixel in decoded.pixels() {
        for (axis, channel) in sum.iter_mut().enumerate() {
            *channel += srgb_byte_to_linear(pixel.0[axis]);
        }
    }
    let count = decoded.pixels().len().max(1) as f64;
    Some([sum[0] / count, sum[1] / count, sum[2] / count])
}

/// Linear diffuse albedo of each material, read from source and not from cache.
pub fn palette(g: &Value, bin: &[u8], source: &Path) -> Palette {
    let directory = source.parent().unwrap_or(Path::new("."));
    crate::compiler::materials::albedo::palette(g, |texture| {
        texture_mean(g, bin, directory, texture)
    })
}
