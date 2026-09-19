//! Answer sheet, and what it contains.
//!
//! Written on EVERY compilation, alongside compiled model, whether there is anything
//! to decide or not: tells whether re-reading is due. Each candidate texture carries
//! its measurement, compiler proposal, and answer —  until someone
//! decides. Answers already given are copied as is, including textures
//! this scene no longer uses: an answer is given once per texture, not once per
//! scene.
use super::*;
use crate::texture_preview::TexturePreview;

/// Candidate texture to decide, as sheet and page present it.
pub(crate) struct Entry {
    pub sha256: String,
    pub name: String,
    pub shape: Value,
    pub proposal: bool,
    pub answer: Option<bool>,
    /// Primitives still in blend clothed by this texture: what deciding yields.
    pub weight: u64,
}

/// Gathers what preview step measured, ONE ENTRY PER IMAGE. Texture without measurement
/// is not a candidate: appears neither in sheet nor page. Multiple
/// textures often cite same image — same foliage under two samplers: they
/// make one row, since answer targets image bytes and holds for all.
/// Blend primitives they hold sum up.
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
        // Cutout is a base color affair: data atlas entry of same texture,
        // when present, is neither a candidate nor extra weight.
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

/// What deciding yields, per texture: blend primitives their materials
/// carry. Texture already decided as cutout has none left and drops
/// to bottom of list — remaining work stays on top.
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

/// Image as human finds it: relative URI, decoded —
/// not . Full path, not just filename,
/// so user asking question can open full resolution texture; user displays
/// only last segment. Embedded image has no file: its index.
fn image_name(images: Option<&Vec<Value>>, image: usize) -> String {
    images
        .and_then(|images| images.get(image))
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .map(|uri| crate::uri::decode(uri).unwrap_or_else(|| uri.to_string()))
        .unwrap_or_else(|| format!("image {image}"))
}

/// Sheet: candidates of this scene, then old answers it does not use,
/// marked as such — nothing decided is lost on next compilation.
///  says what deciding yields, so user asking question shows
/// highest return items first without recomputing.
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
        "about":"Answer per texture: cutout = true for a cutout, false for real transparency, null until someone decides. Preparation asks the question and shows the images; this file can also be edited by hand.",
        "textures":Value::Object(textures)})
}

pub(crate) fn write_sheet(path: &Path, sheet: &Value) -> Result<()> {
    atomic(path, &serde_json::to_vec_pretty(sheet)?)
}
