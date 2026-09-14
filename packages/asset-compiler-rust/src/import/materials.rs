use super::*;

pub(super) fn map_value(map: &ufbx::MaterialMap, default: f64) -> f64 {
    if map.has_value {
        map.value_vec4.x
    } else {
        default
    }
}
pub(super) fn map_texture(map: &ufbx::MaterialMap, textures: &mut TextureTable) -> Option<usize> {
    map.texture
        .as_ref()
        .filter(|_| map.texture_enabled)
        .and_then(|t| textures.texture(t))
}
pub(super) fn texture_id(map: &ufbx::MaterialMap) -> Option<u32> {
    map.texture.as_ref().map(|t| t.element.element_id)
}
pub(super) fn material_json(material: &ufbx::Material, textures: &mut TextureTable) -> Value {
    let pbr = &material.pbr;
    let base_factor = map_value(&pbr.base_factor, 1.0);
    let base = if pbr.base_color.has_value {
        pbr.base_color.value_vec4
    } else {
        ufbx::Vec4 {
            x: 1.0,
            y: 1.0,
            z: 1.0,
            w: 1.0,
        }
    };
    let alpha = map_value(&pbr.opacity, 1.0).clamp(0.0, 1.0);
    let metallic = map_value(&pbr.metalness, 0.0).clamp(0.0, 1.0);
    let roughness = if pbr.roughness.has_value {
        let r = pbr.roughness.value_vec4.x;
        if material.features.roughness_as_glossiness.enabled {
            1.0 - r
        } else {
            r
        }
    } else {
        0.6
    }
    .clamp(0.0, 1.0);
    let emission_factor = map_value(&pbr.emission_factor, 1.0);
    let emissive = if pbr.emission_color.has_value {
        let c = pbr.emission_color.value_vec4;
        [
            c.x * emission_factor,
            c.y * emission_factor,
            c.z * emission_factor,
        ]
    } else {
        [0.0, 0.0, 0.0]
    };
    let mut pbr_json = json!({"baseColorFactor":[(base.x*base_factor).clamp(0.0,1.0),(base.y*base_factor).clamp(0.0,1.0),(base.z*base_factor).clamp(0.0,1.0),alpha],"metallicFactor":metallic,"roughnessFactor":roughness});
    // A bound texture replaces the colour property in FBX; glTF multiplies, so the factor becomes white.
    if let Some(t) = map_texture(&pbr.base_color, textures) {
        pbr_json["baseColorTexture"] = json!({"index":t});
        pbr_json["baseColorFactor"] = json!([1.0, 1.0, 1.0, alpha]);
    }
    let (rough_texture, metal_texture) = (texture_id(&pbr.roughness), texture_id(&pbr.metalness));
    if rough_texture.is_some() && rough_texture == metal_texture {
        if let Some(t) = map_texture(&pbr.roughness, textures) {
            pbr_json["metallicRoughnessTexture"] = json!({"index":t});
        }
    } else if rough_texture.is_some() || metal_texture.is_some() {
        textures.report.add("material-split-metal-roughness");
    }
    let mut out = json!({"name":&*material.element.name,"pbrMetallicRoughness":pbr_json,"emissiveFactor":[emissive[0].clamp(0.0,1.0),emissive[1].clamp(0.0,1.0),emissive[2].clamp(0.0,1.0)]});
    if let Some(t) = map_texture(&pbr.normal_map, textures) {
        out["normalTexture"] = json!({"index":t});
    }
    if let Some(t) = map_texture(&pbr.emission_color, textures) {
        out["emissiveTexture"] = json!({"index":t});
        out["emissiveFactor"] = json!([1.0, 1.0, 1.0]);
    }
    if let Some(t) = map_texture(&pbr.ambient_occlusion, textures) {
        out["occlusionTexture"] = json!({"index":t});
    }
    if material.features.double_sided.enabled {
        out["doubleSided"] = json!(true);
    }
    if alpha < 1.0 {
        out["alphaMode"] = json!("BLEND");
    } else if pbr.opacity.texture.is_some() {
        out["alphaMode"] = json!("MASK");
        out["alphaCutoff"] = json!(0.5);
        if texture_id(&pbr.opacity) != texture_id(&pbr.base_color) {
            textures.report.add("material-separate-opacity-texture");
        }
    }
    out
}
