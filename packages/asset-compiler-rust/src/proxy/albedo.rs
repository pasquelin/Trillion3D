use crate::albedo::{srgb_to_linear, Palette};
use crate::texture_preview::TexturePreview;
use serde_json::Value;

/// Mean color of texture: last level of progressive pyramid, i.e.
/// 1×1 — levels arranged finest to coarsest, occupies last four
/// bytes. Nothing to decode here: compiler already reduced it, re-reading
/// source would create two truths. Texture without preview leaves material factor alone.
fn average(previews: &[TexturePreview], texture: u64) -> Option<[f64; 3]> {
    let preview = previews
        .iter()
        .find(|entry| entry.texture as u64 == texture)?;
    let pixel = preview.pixels.get(preview.pixels.len().checked_sub(4)?..)?;
    Some([
        srgb_to_linear(pixel[0]),
        srgb_to_linear(pixel[1]),
        srgb_to_linear(pixel[2]),
    ])
}

/// Linear diffuse albedo of each scene material, in `materials` array order.
pub fn material_albedo(g: &Value, previews: &[TexturePreview]) -> Palette {
    crate::albedo::palette(g, |texture| average(previews, texture))
}
