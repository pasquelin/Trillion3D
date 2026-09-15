use crate::albedo::{srgb_to_linear, Palette};
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;
use std::collections::BTreeMap;

/// La couleur moyenne d'une texture : le dernier niveau de sa pyramide progressive, qui est
/// justement le 1×1 — les niveaux sont rangés du plus fin au plus grossier, donc il occupe les
/// quatre derniers octets. Il n'y a rien à décoder ici : le compilateur l'a déjà réduit, et relire
/// la source serait deux vérités. Une texture sans aperçu laisse le facteur du matériau seul.
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

/// L'albédo diffus linéaire de chaque matériau de la scène, dans l'ordre du tableau `materials`.
pub fn material_albedo(g: &Value, previews: &[TexturePreview]) -> Result<Palette> {
    // Un aperçu par texture, retrouvé une fois : la recherche linéaire par matériau coûterait le
    // produit des deux tailles sur une scène qui porte des milliers de matériaux.
    let mut cache: BTreeMap<u64, Option<[f64; 3]>> = BTreeMap::new();
    Ok(crate::albedo::palette(g, |texture| {
        *cache
            .entry(texture)
            .or_insert_with(|| average(previews, texture))
    }))
}
