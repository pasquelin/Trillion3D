//! La feuille de réponses, et ce qu'elle contient.
//!
//! Elle est écrite à CHAQUE compilation, à côté du modèle compilé, qu'il y ait quelque chose à
//! trancher ou non : c'est elle qui dit si une relecture est due. Chaque texture candidate y porte
//! sa mesure, la proposition du compilateur, et la réponse — `null` tant que personne ne s'est
//! prononcé. Les réponses déjà données sont recopiées telles quelles, y compris celles de textures
//! que cette scène n'emploie plus : une réponse se donne une fois par texture, pas une fois par
//! scène.
use super::*;
use crate::texture_preview::{preview_level_size, TexturePreview};

/// Une texture à trancher, telle que la feuille et la page la montrent.
pub(crate) struct Entry {
    pub sha256: String,
    pub name: String,
    pub thumbnail: Vec<u8>,
    pub thumbnail_size: (u32, u32),
    pub shape: Value,
    pub proposal: bool,
    pub answer: Option<bool>,
    /// Primitives encore en mélange que cette texture habille : ce que trancher rendrait.
    pub weight: u64,
}

/// Rassemble ce que l'étape des aperçus a mesuré. Une texture sans mesure n'est pas une candidate :
/// elle n'apparaît ni dans la feuille ni dans la page.
pub(crate) fn entries(
    g: &Value,
    previews: &[TexturePreview],
    measures: &BTreeMap<usize, AlphaShape>,
    decisions: &Decisions,
    weights: &BTreeMap<usize, u64>,
) -> Vec<Entry> {
    let images = g.get("images").and_then(Value::as_array);
    previews
        .iter()
        .filter_map(|preview| {
            let shape = measures.get(&(preview.texture as usize))?;
            let size = preview_level_size(preview.width, preview.height, preview.first_level);
            let bytes = (size.0 as usize) * (size.1 as usize) * 4;
            Some(Entry {
                sha256: preview.sha256.clone(),
                name: image_name(images, preview.image as usize),
                thumbnail: preview.pixels.get(..bytes).unwrap_or_default().to_vec(),
                thumbnail_size: size,
                shape: shape.report(),
                proposal: shape.looks_like_cutout(),
                answer: decisions.verdict(&preview.sha256),
                weight: weights
                    .get(&(preview.texture as usize))
                    .copied()
                    .unwrap_or(0),
            })
        })
        .collect()
}

/// Ce que trancher rendrait, par texture : les primitives encore en mélange que ses matériaux
/// portent. Une texture déjà tranchée en découpe n'en a plus, et descend d'elle-même au bas de la
/// liste — ce qui reste à faire est en haut.
pub(crate) fn draw_weights(
    primitives: &[Value],
    materials_by_texture: &BTreeMap<usize, BTreeSet<usize>>,
) -> BTreeMap<usize, u64> {
    let mut by_material: BTreeMap<u64, u64> = BTreeMap::new();
    for primitive in primitives {
        if primitive.get("pass").and_then(Value::as_str) != Some("clustered-blend") {
            continue;
        }
        if let Some(material) = primitive.get("material").and_then(Value::as_u64) {
            *by_material.entry(material).or_default() += 1;
        }
    }
    materials_by_texture
        .iter()
        .map(|(texture, materials)| {
            let count = materials
                .iter()
                .filter_map(|material| by_material.get(&(*material as u64)))
                .sum();
            (*texture, count)
        })
        .collect()
}

/// Le nom qu'un humain reconnaît : le fichier de l'image, ou son rang quand elle est embarquée.
fn image_name(images: Option<&Vec<Value>>, image: usize) -> String {
    images
        .and_then(|images| images.get(image))
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .map(|uri| uri.rsplit('/').next().unwrap_or(uri).to_string())
        .unwrap_or_else(|| format!("image {image}"))
}

/// Écrit la feuille. Elle porte les candidates de cette scène, puis les réponses anciennes qu'elle
/// n'emploie pas, marquées comme telles : rien de ce qui a été tranché ne se perd à la compilation
/// suivante.
pub(crate) fn write_sheet(path: &Path, entries: &[Entry], decisions: &Decisions) -> Result<()> {
    let mut textures = serde_json::Map::new();
    for entry in entries {
        textures.insert(
            entry.sha256.clone(),
            json!({"image":entry.name,"used":true,"measure":entry.shape,
                "proposal":if entry.proposal { "cutout" } else { "blend" },
                "cutout":entry.answer}),
        );
    }
    for (sha256, cutout) in decisions.answers() {
        if !textures.contains_key(sha256) {
            textures.insert(sha256.clone(), json!({"used":false,"cutout":cutout}));
        }
    }
    let sheet = json!({"version":DECISIONS_VERSION,
        "about":"Réponse par texture : cutout = true pour une découpe, false pour une vraie transparence, null tant que personne n'a tranché. Ouvrir decoupes.html pour répondre en voyant les images.",
        "textures":Value::Object(textures)});
    atomic(path, &serde_json::to_vec_pretty(&sheet)?)
}
