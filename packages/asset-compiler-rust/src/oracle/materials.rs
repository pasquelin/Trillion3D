use crate::albedo::{srgb_to_linear, Palette};
use crate::Result;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// La couleur moyenne d'une texture, décodée ici même. L'oracle ne lit pas l'aperçu du cache : il
/// refait la moyenne sur l'image source, si bien que les deux chemins se contrôlent l'un l'autre.
fn texture_mean(g: &Value, directory: &Path, texture: u64) -> Option<[f64; 3]> {
    let image = g
        .get("textures")
        .and_then(Value::as_array)?
        .get(texture as usize)?
        .get("source")
        .and_then(Value::as_u64)?;
    let uri = g
        .get("images")
        .and_then(Value::as_array)?
        .get(image as usize)?
        .get("uri")
        .and_then(Value::as_str)?;
    if uri.starts_with("data:") || uri.contains("..") {
        return None;
    }
    let bytes = std::fs::read(directory.join(uri)).ok()?;
    let decoded = image::load_from_memory(&bytes).ok()?.to_rgb8();
    let mut sum = [0.0f64; 3];
    for pixel in decoded.pixels() {
        for (axis, channel) in sum.iter_mut().enumerate() {
            *channel += srgb_to_linear(pixel.0[axis]);
        }
    }
    let count = decoded.pixels().len().max(1) as f64;
    Some([sum[0] / count, sum[1] / count, sum[2] / count])
}

/// L'albédo diffus linéaire de chaque matériau, lu sur la source et non sur le cache.
pub fn palette(g: &Value, source: &Path) -> Result<Palette> {
    let directory = source.parent().unwrap_or(Path::new(".")).to_path_buf();
    let mut cache: BTreeMap<u64, Option<[f64; 3]>> = BTreeMap::new();
    Ok(crate::albedo::palette(g, |texture| {
        *cache
            .entry(texture)
            .or_insert_with(|| texture_mean(g, &directory, texture))
    }))
}
