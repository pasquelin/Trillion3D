//! The surface parameters a material declares through the physical extensions, beyond the
//! transmission volume the engine record already carries: clear coat, sheen, iridescence,
//! anisotropy, dispersion, specular and bump, and the maps of transmission and thickness.
//!
//! They are written under the host's own parameter names with the host's own defaults — the rule
//! the loader applied when it built the surface — so the prepared scene carries every feature a
//! surface declares and an engine that cannot draw one can still name it instead of losing it
//! silently (`packages/sdk-browser/src/scene/physicalMaterialGate.ts`).
use super::materials::{extension, number, slot, triple};
use super::*;

/// The extensions that make the host build its physical surface rather than its standard one.
const PHYSICAL: [&str; 10] = [
    "KHR_materials_clearcoat",
    "KHR_materials_dispersion",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_ior",
    "KHR_materials_specular",
    "EXT_materials_bump",
    "KHR_materials_anisotropy",
];

type Params = serde_json::Map<String, Value>;

/// A factor the extension declares, copied only when declared: the host keeps its own default
/// otherwise, and so does the reader.
fn factor(into: &mut Params, name: &str, from: &Value, field: &str) {
    if let Some(value) = from.get(field).and_then(Value::as_f64) {
        into.insert(name.into(), json!(value));
    }
}
/// A map slot the extension declares, in the table's slot form.
fn map(into: &mut Params, name: &str, from: &Value, field: &str) {
    if from.get(field).is_some() {
        into.insert(name.into(), slot(from.get(field)));
    }
}

fn clearcoat(p: &mut Params, e: &Value) {
    factor(p, "clearcoat", e, "clearcoatFactor");
    map(p, "clearcoatMap", e, "clearcoatTexture");
    factor(p, "clearcoatRoughness", e, "clearcoatRoughnessFactor");
    map(p, "clearcoatRoughnessMap", e, "clearcoatRoughnessTexture");
    map(p, "clearcoatNormalMap", e, "clearcoatNormalTexture");
    if let Some(scale) = e
        .pointer("/clearcoatNormalTexture/scale")
        .and_then(Value::as_f64)
    {
        p.insert("clearcoatNormalScale".into(), json!(scale));
    }
}
fn iridescence(p: &mut Params, e: &Value) {
    factor(p, "iridescence", e, "iridescenceFactor");
    map(p, "iridescenceMap", e, "iridescenceTexture");
    factor(p, "iridescenceIOR", e, "iridescenceIor");
    let low = number(e.get("iridescenceThicknessMinimum"), 100.0);
    let high = number(e.get("iridescenceThicknessMaximum"), 400.0);
    p.insert("iridescenceThicknessRange".into(), json!([low, high]));
    map(
        p,
        "iridescenceThicknessMap",
        e,
        "iridescenceThicknessTexture",
    );
}
fn sheen(p: &mut Params, e: &Value) {
    p.insert("sheen".into(), json!(1.0));
    p.insert(
        "sheenColor".into(),
        json!(triple(e.get("sheenColorFactor"), [0.0; 3])),
    );
    p.insert(
        "sheenRoughness".into(),
        json!(number(e.get("sheenRoughnessFactor"), 0.0)),
    );
    map(p, "sheenColorMap", e, "sheenColorTexture");
    map(p, "sheenRoughnessMap", e, "sheenRoughnessTexture");
}
fn specular(p: &mut Params, e: &Value) {
    p.insert(
        "specularIntensity".into(),
        json!(number(e.get("specularFactor"), 1.0)),
    );
    map(p, "specularIntensityMap", e, "specularTexture");
    p.insert(
        "specularColor".into(),
        json!(triple(e.get("specularColorFactor"), [1.0; 3])),
    );
    map(p, "specularColorMap", e, "specularColorTexture");
}
fn anisotropy(p: &mut Params, e: &Value) {
    factor(p, "anisotropy", e, "anisotropyStrength");
    factor(p, "anisotropyRotation", e, "anisotropyRotation");
    map(p, "anisotropyMap", e, "anisotropyTexture");
}

/// Whether the host builds this material as its physical surface, and the parameters the physical
/// extensions add to it.
pub(super) fn physical_params(m: &Value) -> (bool, Params) {
    let mut p = Params::new();
    let physical = PHYSICAL.iter().any(|name| extension(m, name).is_some());
    if let Some(e) = extension(m, "KHR_materials_clearcoat") {
        clearcoat(&mut p, e);
    }
    if let Some(e) = extension(m, "KHR_materials_dispersion") {
        p.insert("dispersion".into(), json!(number(e.get("dispersion"), 0.0)));
    }
    if let Some(e) = extension(m, "KHR_materials_iridescence") {
        iridescence(&mut p, e);
    }
    if let Some(e) = extension(m, "KHR_materials_sheen") {
        sheen(&mut p, e);
    }
    if let Some(e) = extension(m, "KHR_materials_transmission") {
        map(&mut p, "transmissionMap", e, "transmissionTexture");
    }
    if let Some(e) = extension(m, "KHR_materials_volume") {
        map(&mut p, "thicknessMap", e, "thicknessTexture");
    }
    if let Some(e) = extension(m, "KHR_materials_specular") {
        specular(&mut p, e);
    }
    if let Some(e) = extension(m, "EXT_materials_bump") {
        p.insert("bumpScale".into(), json!(number(e.get("bumpFactor"), 1.0)));
        map(&mut p, "bumpMap", e, "bumpTexture");
    }
    if let Some(e) = extension(m, "KHR_materials_anisotropy") {
        anisotropy(&mut p, e);
    }
    (physical, p)
}
