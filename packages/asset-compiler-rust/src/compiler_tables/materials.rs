//! Material and texture tables: what the surface of the prepared scene is made of, read from the
//! very glTF the cache publishes and written in the engine's own words.
//!
//! Every default here is glTF 2.0's own — base colour white, metal-rough one, alpha cutoff a half,
//! index of refraction 1.5 — so a material that declares nothing comes out exactly as the loader
//! would build it. Filters and wrapping are the sampler constants of the same specification.
use super::*;

fn number(value: Option<&Value>, default: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(default)
}
fn triple(value: Option<&Value>, default: [f64; 3]) -> [f64; 3] {
    let Some(items) = value.and_then(Value::as_array) else {
        return default;
    };
    let mut out = default;
    for (rank, slot) in out.iter_mut().enumerate() {
        *slot = number(items.get(rank), *slot);
    }
    out
}
fn extension<'a>(owner: &'a Value, name: &str) -> Option<&'a Value> {
    owner.pointer("/extensions").and_then(|e| e.get(name))
}
/// The 3×3 the host composes for a texture, column-major as its elements are. glTF turns its
/// `KHR_texture_transform` the other way round from the host, hence the negated rotation: the rule
/// the loader applies, reproduced here so the table says what the runtime will hold.
fn uv_transform(transform: Option<&Value>) -> [f64; 9] {
    let offset = triple(transform.and_then(|t| t.get("offset")), [0.0, 0.0, 0.0]);
    let scale = triple(transform.and_then(|t| t.get("scale")), [1.0, 1.0, 0.0]);
    let rotation = -number(transform.and_then(|t| t.get("rotation")), 0.0);
    let (cos, sin) = (rotation.cos(), rotation.sin());
    #[rustfmt::skip]
    let elements = [
        scale[0] * cos, -scale[1] * sin, 0.0,
        scale[0] * sin,  scale[1] * cos, 0.0,
        offset[0],       offset[1],      1.0,
    ];
    elements
}
/// One texture slot of a material: which texture, which coordinate set, and the transform composed
/// for it. `null` when the material leaves the slot empty, which is what the engine record holds.
fn slot(info: Option<&Value>) -> Value {
    let Some(info) = info else {
        return Value::Null;
    };
    let Some(index) = info.get("index").and_then(Value::as_u64) else {
        return Value::Null;
    };
    let transform = extension(info, "KHR_texture_transform");
    let tex_coord = transform
        .and_then(|t| t.get("texCoord"))
        .or_else(|| info.get("texCoord"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    json!({"texture":index,"texCoord":tex_coord,"transform":uv_transform(transform)})
}
/// Surface parameters of one glTF material, in the fields the engine record carries.
///
/// `derivative` says the primitive wearing it declares no tangent: the host then rebuilds the
/// tangent frame from screen derivatives and flips the second normal factor to keep the same
/// handedness (three.js issue 11438). One glTF material worn by a primitive with tangents and by
/// one without is therefore two host materials, and two entries of this table.
pub(super) fn material_entry(m: &Value, derivative: bool) -> Value {
    let pbr = m.get("pbrMetallicRoughness");
    let of = |name: &str| pbr.and_then(|p| p.get(name));
    let (normal, occlusion) = (m.get("normalTexture"), m.get("occlusionTexture"));
    let normal_scale = number(normal.and_then(|n| n.get("scale")), 1.0);
    let strength = number(
        extension(m, "KHR_materials_emissive_strength").and_then(|e| e.get("emissiveStrength")),
        1.0,
    );
    let emissive = triple(m.get("emissiveFactor"), [0.0; 3]).map(|c| c * strength);
    let volume = extension(m, "KHR_materials_volume");
    // The host reads no attenuation distance as “no attenuation”, and so does a declared zero,
    // which its own reader turns into an infinity before the engine sees it.
    let far = number(volume.and_then(|v| v.get("attenuationDistance")), 0.0);
    let cutoff = match m.get("alphaMode").and_then(Value::as_str) {
        Some("MASK") => number(m.get("alphaCutoff"), 0.5),
        _ => 0.0,
    };
    let mut entry = json!({
        "name": m.get("name").and_then(Value::as_str).unwrap_or(""),
        "lit": true,
        "baseColor": triple(of("baseColorFactor"), [1.0; 3]),
        "metalness": number(of("metallicFactor"), 1.0),
        "roughness": number(of("roughnessFactor"), 1.0),
        "doubleSided": m.get("doubleSided").and_then(Value::as_bool).unwrap_or(false),
        "backSide": false,
        "alphaTest": cutoff,
        "map": slot(of("baseColorTexture")),
        "metalnessMap": slot(of("metallicRoughnessTexture")),
        "roughnessMap": slot(of("metallicRoughnessTexture")),
        "normalMap": slot(normal),
        "normalScale": normal_scale,
        "normalScaleY": normal_scale * if derivative { -1.0 } else { 1.0 },
        "derivativeTangents": derivative,
        "aoMap": slot(occlusion),
        "aoIntensity": number(occlusion.and_then(|o| o.get("strength")), 1.0),
        "emissive": emissive,
        "emissiveMap": slot(m.get("emissiveTexture")),
        "transmission": number(
            extension(m, "KHR_materials_transmission").and_then(|e| e.get("transmissionFactor")),
            0.0,
        ),
        "ior": number(extension(m, "KHR_materials_ior").and_then(|e| e.get("ior")), 1.5),
        "thickness": number(volume.and_then(|v| v.get("thicknessFactor")), 0.0),
        "attenuationDistance": far,
        "attenuationColor": triple(volume.and_then(|v| v.get("attenuationColor")), [1.0; 3]),
    });
    // `KHR_materials_unlit` builds a surface that answers no light: the host record keeps its
    // base colour and its colour map, and every lit field falls back to the engine's own reading.
    if extension(m, "KHR_materials_unlit").is_some() {
        for (field, value) in [
            ("lit", json!(false)),
            ("metalness", json!(0.0)),
            ("roughness", json!(1.0)),
            ("metalnessMap", Value::Null),
            ("roughnessMap", Value::Null),
            ("normalMap", Value::Null),
            ("normalScale", json!(1.0)),
            ("normalScaleY", json!(1.0)),
            ("aoMap", Value::Null),
            ("aoIntensity", json!(1.0)),
            ("emissive", json!([0.0, 0.0, 0.0])),
            ("emissiveMap", Value::Null),
            ("transmission", json!(0.0)),
            ("ior", json!(1.5)),
            ("thickness", json!(0.0)),
            ("attenuationDistance", json!(0.0)),
            ("attenuationColor", json!([1.0, 1.0, 1.0])),
        ] {
            entry[field] = value;
        }
    }
    entry
}
fn wrap(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_u64) {
        Some(33071) => "clamp",
        Some(33648) => "mirror",
        _ => "repeat",
    }
}
fn filter(value: Option<&Value>, default: &'static str) -> &'static str {
    match value.and_then(Value::as_u64) {
        Some(9728) => "nearest",
        Some(9729) => "linear",
        Some(9984) => "nearest-mip-nearest",
        Some(9985) => "linear-mip-nearest",
        Some(9986) => "nearest-mip-linear",
        Some(9987) => "linear-mip-linear",
        _ => default,
    }
}
/// Sampler state of every texture of the published scene, at its own rank. A texture without a
/// sampler takes the specification's defaults, the very ones the loader falls back to.
pub(super) fn texture_table(g: &Value) -> Vec<Value> {
    let samplers = g.get("samplers").and_then(Value::as_array);
    let empty = json!({});
    g.get("textures")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|texture| {
            let sampler = texture
                .get("sampler")
                .and_then(Value::as_u64)
                .and_then(|id| samplers.and_then(|list| list.get(id as usize)))
                .unwrap_or(&empty);
            json!({
                "image": texture.get("source").and_then(Value::as_u64),
                "wrapS": wrap(sampler.get("wrapS")),
                "wrapT": wrap(sampler.get("wrapT")),
                "magFilter": filter(sampler.get("magFilter"), "linear"),
                "minFilter": filter(sampler.get("minFilter"), "linear-mip-linear"),
            })
        })
        .collect()
}
