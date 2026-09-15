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
/// Les options d'une map que la sortie ne porte pas : décalage et échelle demanderaient
/// `KHR_texture_transform`, que l'écrivain glTF ne connaît pas, et rien ne porte la force d'un
/// relief. Comptées sur toutes les maps du matériau, converties ou non — une option déclarée et
/// restée sans effet est une perte, que la map ait fini dans la sortie ou non.
fn map_options(material: &ufbx::Material, report: &mut Report) {
    for bound in &material.textures {
        for (option, code) in [
            ("o", "texture-offset"),
            ("s", "texture-scale"),
            ("bm", "texture-bump-scale"),
        ] {
            if bound.texture.element.props.find_prop(option).is_some() {
                report.add(code);
            }
        }
    }
}

/// Une couleur qui apporte quelque chose : noire, elle ne se perd pas à ne pas être portée.
fn lit(map: &ufbx::MaterialMap) -> bool {
    map.has_value && map.value_vec4.x + map.value_vec4.y + map.value_vec4.z > 0.0
}

/// Ce que le modèle métal-rugosité de glTF ne sait pas porter, compté par son nom plutôt qu'avalé.
/// Rien n'est deviné au passage : une couleur spéculaire ne devient pas du métal, ce sont deux
/// modèles, et un relief n'est pas une normale.
fn unconverted(material: &ufbx::Material, normal: &ufbx::MaterialMap, report: &mut Report) {
    let (pbr, fbx) = (&material.pbr, &material.fbx);
    if lit(&pbr.specular_color) || pbr.specular_color.texture.is_some() {
        report.add("material-specular-color");
    }
    // glTF pose l'indice de réfraction à 1,5 par défaut : un autre indice est le seul qui se perde.
    if pbr.specular_ior.has_value && (pbr.specular_ior.value_vec4.x - 1.5).abs() > 1e-6 {
        report.add("material-specular-ior");
    }
    let ambient = &fbx.ambient_color;
    let ambient_elsewhere = ambient.texture.is_some()
        && texture_id(ambient) != texture_id(&pbr.ambient_occlusion)
        && texture_id(ambient) != texture_id(&pbr.base_color);
    if lit(ambient) || ambient_elsewhere {
        report.add("material-ambient-color");
    }
    // Relief et normale visent la même fente glTF. La normale l'emporte — c'est la carte que le
    // modèle attend —, et le relief laissé derrière est compté, jamais un « dernier gagne » muet.
    if fbx.bump.texture.is_some() && texture_id(&fbx.bump) != texture_id(normal) {
        report.add("material-bump-map");
    }
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
    let opacity = read_opacity(material);
    let alpha = opacity.alpha;
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
    // Une carte d'opacité rend le matériau transparent ; aucun format d'import ne déclare de seuil
    // de découpe, donc jamais `MASK` — un transparent découpé serait une perte de fidélité. glTF ne
    // sait porter l'opacité que dans l'alpha de la couleur de base : une carte séparée ne se branche
    // pas, elle se signale plutôt que d'être avalée.
    if let Some(map) = opacity.texture {
        out["alphaMode"] = json!("BLEND");
        if texture_id(map) != texture_id(&pbr.base_color) {
            textures.report.add("material-separate-opacity-texture");
        }
    } else if alpha < 1.0 {
        out["alphaMode"] = json!("BLEND");
    }
    unconverted(material, &pbr.normal_map, textures.report);
    map_options(material, textures.report);
    out
}
