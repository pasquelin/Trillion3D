//! What an answer changes in scene, and cases where it is refused.
//!
//! An answer targets a TEXTURE, and a texture sometimes serves multiple materials: answer
//! applies to all its base color bindings, otherwise two surfaces of same leaf
//! would contradict on screen. Two shapes refused even when answer says "cutout":
//! material transmitting light — tinted glass keeps thickness — and material
//! whose alpha factor is already partial, where opacity does not come from texture.
use super::*;
use crate::texture_preview::{collect, source};

/// What step did.  enters product identity: a "window" answer,
/// refusal, or answer targeting texture this scene does not use changes no bytes
/// and must not shift cache key.
pub(crate) struct CutoutApplied {
    pub applied: Vec<Value>,
    pub refused: Vec<Value>,
    /// Materials each candidate texture clothes. Keys are textures to measure —
    /// preview step receives them as is —, values serve to display first
    /// those holding most blend primitives.
    pub materials_by_texture: BTreeMap<usize, BTreeSet<usize>>,
}

impl CutoutApplied {
    /// Textures whose alpha is to measure: all candidates, including those an
    /// answer just flipped — page still displays them to allow revising opinion.
    pub fn to_measure(&self) -> BTreeSet<usize> {
        self.materials_by_texture.keys().copied().collect()
    }
    pub fn report(&self, decisions: &Decisions) -> Value {
        json!({"decisions":decisions.report(),"candidateTextures":self.materials_by_texture.len(),
            "applied":self.applied,"refused":self.refused})
    }
}

/// Candidate binding: material declared in blend whose base color carries a texture.
struct Candidate {
    material: usize,
    texture: usize,
    image_sha: String,
}

pub(crate) fn apply_decisions(
    g: &mut Value,
    bin: &[u8],
    image_root: &Path,
    meshes: &BTreeSet<usize>,
    decisions: &Decisions,
) -> Result<CutoutApplied> {
    let candidates = candidates(g, bin, image_root, meshes)?;
    let (mut applied, mut refused) = (Vec::new(), Vec::new());
    let mut materials_by_texture: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for candidate in &candidates {
        materials_by_texture
            .entry(candidate.texture)
            .or_default()
            .insert(candidate.material);
        if decisions.verdict(&candidate.image_sha) != Some(true) {
            continue;
        }
        if let Some(reason) = refusal(g, candidate.material) {
            refused.push(json!({"material":candidate.material,"reason":reason}));
            continue;
        }
        let Some(material) = g
            .get_mut("materials")
            .and_then(Value::as_array_mut)
            .and_then(|materials| materials.get_mut(candidate.material))
        else {
            continue;
        };
        material["alphaMode"] = json!("MASK");
        if material.get("alphaCutoff").is_none() {
            material["alphaCutoff"] = json!(CUTOUT_ALPHA);
        }
        applied.push(
            json!({"material":candidate.material,"texture":candidate.texture,"image":candidate.image_sha}),
        );
    }
    Ok(CutoutApplied {
        applied,
        refused,
        materials_by_texture,
    })
}

/// Why material stays in blend despite answer, or  when nothing opposes.
fn refusal(g: &Value, material: usize) -> Option<&'static str> {
    let material = g
        .get("materials")
        .and_then(Value::as_array)
        .and_then(|materials| materials.get(material))?;
    if unsplit_material(Some(material)) {
        return Some("transmission");
    }
    let factor = material
        .pointer("/pbrMetallicRoughness/baseColorFactor")
        .and_then(Value::as_array)
        .and_then(|factor| factor.get(3))
        .and_then(Value::as_f64);
    if factor.is_some_and(|alpha| alpha < 1.0) {
        return Some("alpha-factor");
    }
    None
}

/// Candidate bindings of scene, each with image fingerprint. A shared image
/// read and hashed only once IN THIS STEP — preview step re-reads same bytes
/// to decode, total pass measured at 0.08 s on , not justifying
/// holding bytes in memory between the two. Unreadable image is not a
/// candidate, preview step will name it in report as it already does.
fn candidates(
    g: &Value,
    bin: &[u8],
    image_root: &Path,
    meshes: &BTreeSet<usize>,
) -> Result<Vec<Candidate>> {
    let (Some(materials), Some(textures), Some(images)) = (
        g.get("materials").and_then(Value::as_array),
        g.get("textures").and_then(Value::as_array),
        g.get("images").and_then(Value::as_array),
    ) else {
        return Ok(Vec::new());
    };
    // Reading and hashing candidate images is what this step costs before measurement: a
    // shared image is read once, and counter reports what pass is worth.
    let _t = perf::Timer::new(perf::Phase::CutoutScan);
    let mut hashes: BTreeMap<usize, String> = BTreeMap::new();
    let mut found = Vec::new();
    for id in collect::used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        if material.get("alphaMode").and_then(Value::as_str) != Some("BLEND") {
            continue;
        }
        let Some(texture) =
            collect::texture_index(material.pointer("/pbrMetallicRoughness/baseColorTexture"))
        else {
            continue;
        };
        let Some(image) = textures
            .get(texture)
            .and_then(|texture| texture.get("source"))
            .and_then(Value::as_u64)
            .map(|image| image as usize)
        else {
            continue;
        };
        let sha = match hashes.get(&image) {
            Some(known) => known.clone(),
            None => {
                let Some(bytes) = images
                    .get(image)
                    .and_then(|image| source::raw_image_bytes(g, bin, image_root, image).ok())
                else {
                    continue;
                };
                let sha = hash(&bytes.0);
                hashes.insert(image, sha.clone());
                sha
            }
        };
        found.push(Candidate {
            material: id,
            texture,
            image_sha: sha,
        });
    }
    Ok(found)
}
