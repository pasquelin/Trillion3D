//! What an answer changes in scene, and cases where it is refused.
//!
//! An answer targets a TEXTURE, and a texture sometimes serves multiple materials: answer
//! applies to all its base color bindings, otherwise two surfaces of same leaf
//! would contradict on screen. Two shapes refused even when answer says "cutout":
//! material transmitting light — tinted glass keeps thickness — and material
//! whose alpha factor is already partial, where opacity does not come from texture.
use super::*;
use crate::compiler_materials::MaterialFactors;
use crate::texture_preview::{admission, source};

mod candidates;
use candidates::{candidates, Candidate};

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

/// Reclassifies the candidates an answer, or else their measurement, names cutout. `used` are the
/// materials of the compiled meshes and `shas` the fingerprint of each image
/// (`source::ImageShas`), both taken once for the whole compilation. The images to measure decode
/// under the job's allowance less `reserved`, what the job already holds.
pub(crate) fn apply_decisions(
    (o, reserved): (&Options, usize),
    g: &mut Value,
    (bin, image_root): (&[u8], &Path),
    (used, shas): (&BTreeSet<usize>, &source::ImageShas),
    decisions: &mut Decisions,
) -> Result<CutoutApplied> {
    let candidates = candidates(g, used, shas);
    let measured = measure_unanswered((o, reserved), (g, bin, image_root), &candidates, decisions)?;
    let (mut applied, mut refused) = (Vec::new(), Vec::new());
    let mut materials_by_texture: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for candidate in &candidates {
        materials_by_texture
            .entry(candidate.texture)
            .or_default()
            .insert(candidate.material);
        let verdict = decisions
            .verdict(&candidate.image_sha)
            .or_else(|| measured.get(&candidate.image_sha).copied());
        if verdict != Some(true) {
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

/// The verdict of each image no answer names, by its fingerprint: its stored measurement, or
/// the image decoded and measured once — kept with the others, so the preview step measures it
/// no more. The images left to measure decode side by side, each from its borrowed bytes, as many
/// at once as the bake's admission runs (`admission::decode_admitted`); their pixels are dropped at
/// once, since holding them until the bake would hold every one through the geometry compile,
/// which no budget counts. An image that does not decode to RGBA8 has none, and stays blend.
fn measure_unanswered(
    admitted: (&Options, usize),
    source: (&Value, &[u8], &Path),
    candidates: &[Candidate],
    decisions: &mut Decisions,
) -> Result<BTreeMap<String, bool>> {
    let mut verdicts = BTreeMap::new();
    let mut unmeasured = BTreeMap::new();
    for Candidate {
        image, image_sha, ..
    } in candidates
    {
        if decisions.verdict(image_sha).is_some() || verdicts.contains_key(image_sha) {
            continue;
        }
        match decisions.measurements.known(image_sha) {
            Some(shape) => {
                verdicts.insert(image_sha.clone(), shape.looks_like_cutout());
            }
            None => {
                unmeasured.entry(image_sha).or_insert(*image);
            }
        }
    }
    let (g, bin, image_root) = source;
    let images = g.get("images").and_then(Value::as_array);
    let (shas, indices): (Vec<&String>, Vec<usize>) = unmeasured.into_iter().unzip();
    let measured = admission::decode_admitted(admitted.0, admitted.1, source, &indices, |image| {
        let image = images?.get(image)?;
        let decoded = source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            crate::plugins::image::decode(bytes, crate::texture_preview::PREVIEW_MAX_ALLOC)
        });
        let crate::plugins::image::DecodedImage::Rgba8(pixels) = decoded.ok()?.image else {
            return None;
        };
        let _t = perf::Timer::new(perf::Phase::TextureAlpha);
        Some(measure(&pixels))
    })?;
    for (sha, shape) in shas.into_iter().zip(measured) {
        let Some(shape) = shape else {
            continue;
        };
        verdicts.insert(sha.clone(), shape.looks_like_cutout());
        decisions.measurements.insert(sha.clone(), shape);
    }
    Ok(verdicts)
}

/// Why material stays in blend despite answer, or  when nothing opposes.
fn refusal(g: &Value, material: usize) -> Option<&'static str> {
    let material = g
        .get("materials")
        .and_then(Value::as_array)
        .and_then(|materials| materials.get(material))?;
    if transmissive_material(Some(material)) {
        return Some("transmission");
    }
    if MaterialFactors::of(material).base_colour[3] < 1.0 {
        return Some("alpha-factor");
    }
    None
}
