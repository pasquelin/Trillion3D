//! Palette slots are authored material identities, including equal-valued colours.
use super::*;
fn default_palette() -> [[u8; 4]; 256] {
    let mut colors = [[0; 4]; 256];
    let mut slot = 1;
    for r in (0..=5).rev() {
        for g in (0..=5).rev() {
            for b in (0..=5).rev() {
                if r + g + b == 0 {
                    continue;
                }
                colors[slot] = [r * 51, g * 51, b * 51, 255];
                slot += 1;
            }
        }
    }
    for channel in 0..4 {
        for value in [238, 221, 187, 170, 136, 119, 85, 68, 34, 17] {
            let mut color = [0, 0, 0, 255];
            if channel == 3 {
                color[..3].fill(value);
            } else {
                color[channel] = value;
            }
            colors[slot] = color;
            slot += 1;
        }
    }
    colors
}
fn number(props: &Dict, key: &str, default: f64) -> Result<f64> {
    let value = props
        .get(key)
        .map(|v| v.parse::<f64>())
        .transpose()
        .map_err(|_| source::invalid("vox", format!("material {key}")))?
        .unwrap_or(default);
    if !value.is_finite() {
        return Err(source::invalid("vox", "non-finite material"));
    }
    Ok(value)
}
pub(super) fn emit(doc: &Document, scene: &mut SceneTables) -> Result<BTreeMap<u8, usize>> {
    let colors = doc.palette.unwrap_or_else(default_palette);
    let used: std::collections::BTreeSet<_> = doc
        .models
        .iter()
        .flat_map(|m| m.voxels.iter().map(|v| v[3]))
        .collect();
    let mut ranks = BTreeMap::new();
    for slot in used {
        let color = source::linear_color(colors[slot as usize].map(|v| v as f32 / 255.0));
        let mut material = source::material(&format!("palette-{slot}"), color);
        material["extras"] = json!({"voxPaletteIndex":slot});
        if let Some(props) = doc.materials.get(&(slot as u32)) {
            material["extras"]["voxMaterial"] = json!(props);
            let kind = props.get("_type").map(String::as_str).unwrap_or("_diffuse");
            let weight = number(props, "_weight", 1.0)?.clamp(0.0, 1.0);
            material["pbrMetallicRoughness"]["roughnessFactor"] =
                json!(number(props, "_rough", 1.0)?.clamp(0.0, 1.0));
            match kind {
                "_diffuse" => {}
                "_metal" => material["pbrMetallicRoughness"]["metallicFactor"] = json!(weight),
                "_emit" => {
                    material["emissiveFactor"] = json!([
                        color[0] as f64 * weight,
                        color[1] as f64 * weight,
                        color[2] as f64 * weight
                    ])
                }
                "_glass" => {
                    material["extensions"] = json!({"KHR_materials_transmission":{"transmissionFactor":weight},"KHR_materials_ior":{"ior":number(props,"_ior",1.5)?.max(1.0)}})
                }
                _ => return Err(source::unsupported("vox", format!("material {kind}"))),
            }
            for key in ["_flux", "_att", "_plastic", "_spec"] {
                if props.contains_key(key) {
                    scene.report.add("vox-material-property-unmapped");
                }
            }
        }
        ranks.insert(slot, scene.materials.len());
        scene.materials.push(material);
    }
    Ok(ranks)
}
