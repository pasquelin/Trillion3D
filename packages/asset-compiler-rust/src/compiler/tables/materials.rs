//! Material table: what the surface of the prepared scene is made of, read from the
//! very glTF the cache publishes and written in the engine's own words.
//!
//! Every default here is glTF 2.0's own — base colour white, metal-rough one, alpha cutoff a half,
//! index of refraction 1.5 — so a material that declares nothing comes out exactly as the loader
//! would build it.
use super::physical::physical_params;
use super::*;
use crate::compiler::materials::{sampled_set, triple, AlphaMode, MaterialFactors};
use crate::compiler::validate::number_or;

pub(super) fn extension<'a>(owner: &'a Value, name: &str) -> Option<&'a Value> {
    owner.get("extensions").and_then(|e| e.get(name))
}
/// The `KHR_texture_transform` of a slot as it is declared — offset, rotation and scale, each
/// `null` when silent — or `null` when the slot declares none. The host composes the matrix itself,
/// from these three numbers, exactly as it composes the transform of any texture it owns.
fn uv_transform(transform: Option<&Value>) -> Value {
    let Some(transform) = transform else {
        return Value::Null;
    };
    let field = |name: &str| transform.get(name).cloned().unwrap_or(Value::Null);
    json!({"offset":field("offset"),"rotation":field("rotation"),"scale":field("scale")})
}
/// One texture slot of a material: which texture, which coordinate set it samples — its
/// `KHR_texture_transform`'s when that one names a set —, the set the slot names itself, and the
/// transform it declares. `null` when the material leaves the slot empty, which is what the engine
/// record holds. The slot's own set is kept beside the one sampled: it is what decides whether the
/// host reads the glTF texture itself or a copy of it, and so which texture rank the slot keeps.
pub(crate) fn slot(info: Option<&Value>) -> Value {
    let Some(info) = info else {
        return Value::Null;
    };
    let Some(index) = info.get("index").and_then(Value::as_u64) else {
        return Value::Null;
    };
    let transform = extension(info, "KHR_texture_transform");
    let own = info.get("texCoord").and_then(Value::as_u64).unwrap_or(0);
    json!({"texture":index,"texCoord":sampled_set(info),"slotTexCoord":own,"transform":uv_transform(transform)})
}
/// Surface parameters of one glTF material, in the fields the engine record carries.
///
/// `derivative` says the primitive wearing it declares no tangent: the host then rebuilds the
/// tangent frame from screen derivatives and flips the second normal factor to keep the same
/// handedness. One glTF material worn by a primitive with tangents and by
/// one without is therefore two host materials, and two entries of this table.
pub(super) fn material_entry(m: &Value, derivative: bool) -> Value {
    let pbr = m.get("pbrMetallicRoughness");
    let of = |name: &str| pbr.and_then(|p| p.get(name));
    let (normal, occlusion) = (m.get("normalTexture"), m.get("occlusionTexture"));
    let normal_scale = number_or(normal.and_then(|n| n.get("scale")), 1.0);
    let volume = extension(m, "KHR_materials_volume");
    // The host reads no attenuation distance as “no attenuation”, and so does a declared zero,
    // which its own reader turns into an infinity before the engine sees it.
    let far = number_or(volume.and_then(|v| v.get("attenuationDistance")), 0.0);
    let alpha = AlphaMode::of(m);
    let cutoff = match alpha {
        AlphaMode::Mask(cutoff) => cutoff,
        _ => 0.0,
    };
    let factors = MaterialFactors::of(m);
    let emissive = factors.emission;
    let [red, green, blue, opacity] = factors.base_colour;
    let unlit = extension(m, "KHR_materials_unlit").is_some();
    let (physical, extras) = physical_params(m);
    let mut entry = json!({
        "name": name_of(m),
        "kind": if unlit { "unlit" } else if physical { "physical" } else { "standard" },
        "alphaMode": alpha.name(),
        "opacity": opacity,
        "extensions": if unlit { json!({}) } else { Value::Object(extras) },
        "lit": true,
        "baseColor": [red, green, blue],
        "metalness": factors.metallic,
        "roughness": factors.roughness,
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
        "aoIntensity": number_or(occlusion.and_then(|o| o.get("strength")), 1.0),
        "emissive": emissive,
        "emissiveMap": slot(m.get("emissiveTexture")),
        "transmission": factors.transmission,
        "ior": number_or(extension(m, "KHR_materials_ior").and_then(|e| e.get("ior")), 1.5),
        // Whether the material declares `KHR_materials_ior`: only then does it refract; without
        // it a transmissive surface is drawn thin, its index never assumed.
        "hasIor": extension(m, "KHR_materials_ior").is_some(),
        "thickness": number_or(volume.and_then(|v| v.get("thicknessFactor")), 0.0),
        "attenuationDistance": far,
        "attenuationColor": triple(volume.and_then(|v| v.get("attenuationColor")), [1.0; 3]),
    });
    // `KHR_materials_unlit` builds a surface that answers no light: the host record keeps its
    // base colour and its colour map, and every lit field falls back to the engine's own reading.
    if unlit {
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
            ("hasIor", json!(false)),
            ("thickness", json!(0.0)),
            ("attenuationDistance", json!(0.0)),
            ("attenuationColor", json!([1.0, 1.0, 1.0])),
        ] {
            entry[field] = value;
        }
    }
    entry
}
