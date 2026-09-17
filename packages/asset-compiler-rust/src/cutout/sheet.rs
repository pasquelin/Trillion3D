//! La feuille de réponses, et ce qu'elle contient.
//!
//! Elle est écrite à CHAQUE compilation, à côté du modèle compilé, qu'il y ait quelque chose à
//! trancher ou non : c'est elle qui dit si une relecture est due. Chaque texture candidate y porte
//! sa mesure, la proposition du compilateur, et la réponse — `null` tant que personne ne s'est
//! prononcé. Les réponses déjà données sont recopiées telles quelles, y compris celles de textures
//! que cette scène n'emploie plus : une réponse se donne une fois par texture, pas une fois par
//! scène.
use super::*;
use crate::texture_preview::TexturePreview;

/// Une texture à trancher, telle que la feuille et la page la montrent.
pub(crate) struct Entry {
    pub sha256: String,
    pub name: String,
    pub shape: Value,
    pub proposal: bool,
    pub answer: Option<bool>,
    /// Primitives encore en mélange que cette texture habille : ce que trancher rendrait.
    pub weight: u64,
}

/// Rassemble ce que l'étape des aperçus a mesuré, UNE ENTRÉE PAR IMAGE. Une texture sans mesure
/// n'est pas une candidate : elle n'apparaît ni dans la feuille ni dans la page. Et plusieurs
/// textures citent souvent la même image — le même feuillage sous deux échantillonneurs : elles ne
/// font qu'une ligne, puisque la réponse porte sur les octets de l'image et vaut pour toutes. Ce
/// qu'elles tiennent de primitives en mélange s'additionne.
pub(crate) fn entries(
    g: &Value,
    previews: &[TexturePreview],
    measures: &BTreeMap<usize, AlphaShape>,
    decisions: &Decisions,
    weights: &BTreeMap<usize, u64>,
) -> Vec<Entry> {
    let images = g.get("images").and_then(Value::as_array);
    let mut by_image: BTreeMap<String, Entry> = BTreeMap::new();
    for preview in previews {
        // Une découpe est une affaire de couleur de base : l'entrée de l'atlas de données d'une
        // même texture, quand il y en a une, n'est ni une candidate ni un poids de plus.
        if preview.kind != crate::texture_preview::AtlasKind::Color {
            continue;
        }
        let texture = preview.texture as usize;
        let Some(shape) = measures.get(&texture) else {
            continue;
        };
        let weight = weights.get(&texture).copied().unwrap_or(0);
        if let Some(known) = by_image.get_mut(&preview.sha256) {
            known.weight += weight;
            continue;
        }
        by_image.insert(
            preview.sha256.clone(),
            Entry {
                sha256: preview.sha256.clone(),
                name: image_name(images, preview.image as usize),
                shape: shape.report(),
                proposal: shape.looks_like_cutout(),
                answer: decisions.verdict(&preview.sha256),
                weight,
            },
        );
    }
    by_image.into_values().collect()
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

/// L'image telle qu'un humain la retrouve : son URI relative, décodée — `textures/feuillage été.png`
/// et non `textures/feuillage%20%C3%A9t%C3%A9.png`. Le chemin entier, et pas seulement le nom de
/// fichier, pour que celui qui pose la question puisse ouvrir la texture en pleine résolution ; à
/// lui de n'afficher que le dernier segment. Une image embarquée n'a pas de fichier : son rang.
fn image_name(images: Option<&Vec<Value>>, image: usize) -> String {
    images
        .and_then(|images| images.get(image))
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .map(|uri| crate::uri::decode(uri).unwrap_or_else(|| uri.to_string()))
        .unwrap_or_else(|| format!("image {image}"))
}

/// La feuille : les candidates de cette scène, puis les réponses anciennes qu'elle n'emploie pas,
/// marquées comme telles — rien de ce qui a été tranché ne se perd à la compilation suivante.
/// `blendPrimitives` dit ce que trancher rendrait, pour que celui qui pose la question montre
/// d'abord ce qui rapporte le plus, sans avoir à le recalculer.
pub(crate) fn build_sheet(entries: &[Entry], decisions: &Decisions) -> Value {
    let mut textures = serde_json::Map::new();
    for entry in entries {
        textures.insert(
            entry.sha256.clone(),
            json!({"image":entry.name,"used":true,"measure":entry.shape,
                "blendPrimitives":entry.weight,
                "proposal":if entry.proposal { "cutout" } else { "blend" },
                "cutout":entry.answer}),
        );
    }
    for (sha256, cutout) in decisions.answers() {
        if !textures.contains_key(sha256) {
            textures.insert(sha256.clone(), json!({"used":false,"cutout":cutout}));
        }
    }
    json!({"version":SHEET_VERSION,
        "about":"Réponse par texture : cutout = true pour une découpe, false pour une vraie transparence, null tant que personne n'a tranché. Ouvrir decoupes.html pour répondre en voyant les images.",
        "textures":Value::Object(textures)})
}

pub(crate) fn write_sheet(path: &Path, sheet: &Value) -> Result<()> {
    atomic(path, &serde_json::to_vec_pretty(sheet)?)
}
