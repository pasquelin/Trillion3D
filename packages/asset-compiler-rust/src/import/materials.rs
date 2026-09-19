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
/// Which file a map talks about. Comparing **elements** is not enough: a material
/// library makes one element per line, so `norm x.png` and `map_Bump x.png` — the
/// same file, declared twice — used to pass as two different maps.
pub(super) fn texture_file(map: &ufbx::MaterialMap) -> Option<&str> {
    let texture = map.texture.as_ref()?;
    [
        &texture.relative_filename,
        &texture.filename,
        &texture.absolute_filename,
    ]
    .into_iter()
    .map(|declared| &**declared)
    .find(|declared| !declared.is_empty())
}
/// Map options the output does not carry: offset and scale would need
/// `KHR_texture_transform`, which the glTF writer does not know, and nothing
/// carries bump strength. Counted on every map of the material, converted or
/// not — a declared option that stayed without effect is a loss, whether the
/// map ended in the output or not.
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

/// A colour that brings something: black, it is not lost by not being carried.
fn lit(map: &ufbx::MaterialMap) -> bool {
    map.has_value && map.value_vec4.x + map.value_vec4.y + map.value_vec4.z > 0.0
}

/// What glTF's metal-roughness model cannot carry, counted by name rather than
/// swallowed. Nothing is guessed along the way: a specular colour does not become
/// metal, those are two models, and a bump is not a normal.
fn unconverted(material: &ufbx::Material, normal: &ufbx::MaterialMap, report: &mut Report) {
    let (pbr, fbx) = (&material.pbr, &material.fbx);
    if lit(&pbr.specular_color) || pbr.specular_color.texture.is_some() {
        report.add("material-specular-color");
    }
    // glTF sets the index of refraction to 1.5 by default: another index is the only one lost.
    if pbr.specular_ior.has_value && (pbr.specular_ior.value_vec4.x - 1.5).abs() > 1e-6 {
        report.add("material-specular-ior");
    }
    let ambient = &fbx.ambient_color;
    let ambient_elsewhere = ambient.texture.is_some()
        && texture_file(ambient) != texture_file(&pbr.ambient_occlusion)
        && texture_file(ambient) != texture_file(&pbr.base_color);
    if lit(ambient) || ambient_elsewhere {
        report.add("material-ambient-color");
    }
    // Bump and normal aim at the same glTF slot. The normal wins — it is the map
    // the model expects — and the leftover bump is counted, never a silent "last wins".
    if fbx.bump.texture.is_some() && texture_file(&fbx.bump) != texture_file(normal) {
        report.add("material-bump-map");
    }
}

/// A factor at glTF's single precision, so a last-bit difference between platforms disappears.
fn single(value: f64) -> f64 {
    value as f32 as f64
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
    // The driver derives roughness from a specular exponent in C, and that arithmetic is not
    // bit-identical across platforms (the compiler fuses multiply-adds on some targets). glTF
    // factors are single-precision floats: rounding to f32 keeps the value the driver meant and
    // makes the compiled output the same on every machine.
    let roughness = if pbr.roughness.has_value {
        let r = pbr.roughness.value_vec4.x;
        single(if material.features.roughness_as_glossiness.enabled {
            1.0 - r
        } else {
            r
        })
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
    let (rough_texture, metal_texture) =
        (texture_file(&pbr.roughness), texture_file(&pbr.metalness));
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
    // An opacity map makes the material transparent; no import format declares a
    // cutout threshold, so never `MASK` — a cut-out transparent would be a fidelity
    // loss. glTF can only carry opacity in the base-colour alpha: a separate map
    // is not wired, it is reported rather than swallowed.
    if let Some(map) = opacity.texture {
        out["alphaMode"] = json!("BLEND");
        if texture_file(map) != texture_file(&pbr.base_color) {
            textures.report.add("material-separate-opacity-texture");
        }
    } else if alpha < 1.0 {
        out["alphaMode"] = json!("BLEND");
    }
    unconverted(material, &pbr.normal_map, textures.report);
    map_options(material, textures.report);
    out
}
