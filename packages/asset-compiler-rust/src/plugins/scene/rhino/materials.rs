//! Material indices come from native object/layer bindings, never colour deduplication.
use super::*;
#[derive(Deserialize, serde::Serialize)]
pub(super) struct Material {
    pub id: String,
    pub archive_index: Option<i32>,
    pub name: String,
    diffuse: [u8; 4],
    emission: [u8; 4],
    transparency: f64,
    shine: f64,
    reflectivity: f64,
    texture_count: usize,
    disable_lighting: bool,
    physically_based: Option<Pbr>,
    #[serde(flatten)]
    other: BTreeMap<String, serde_json::Value>,
}
#[derive(Deserialize, serde::Serialize)]
struct Pbr {
    base_color: [f32; 4],
    metallic: f64,
    roughness: f64,
    opacity: f64,
    emission: [f32; 4],
    #[serde(flatten)]
    other: BTreeMap<String, serde_json::Value>,
}
impl Material {
    pub(super) fn json(&self, _scene: &mut SceneTables) -> Result<serde_json::Value> {
        if self.texture_count != 0 {
            return Err(source::unsupported("3dm", "textured material"));
        }
        if self.physically_based.is_some() {
            return Err(source::unsupported(
                "3dm",
                "Rhino advanced physically based material",
            ));
        }
        if self.shine != 0.0
            || self.reflectivity != 0.0
            || self.transparency != 0.0
            || self
                .other
                .get("fresnel_reflections")
                .and_then(|v| v.as_bool())
                == Some(true)
            || self
                .other
                .get("ambient")
                .and_then(|v| v.as_array())
                .is_some_and(|v| v.iter().take(3).any(|c| c.as_u64() != Some(0)))
        {
            return Err(source::unsupported(
                "3dm",
                "Rhino legacy reflective, refractive, glossy or ambient material",
            ));
        }
        let mut color = source::linear_color(self.diffuse.map(|v| v as f32 / 255.0));
        color[3] = (1.0 - self.transparency).clamp(0.0, 1.0) as f32;
        let mut value = source::material(&self.name, color);
        value["extras"] = json!({"rhinoMaterialId":self.id,"rhinoMaterialIndex":self.archive_index,"rhinoSourceMaterial":self});

        let emission = source::linear_color(self.emission.map(|v| v as f32 / 255.0));
        value["emissiveFactor"] = json!(&emission[..3]);
        if self.disable_lighting {
            value["extensions"] = json!({"KHR_materials_unlit":{}});
        }
        Ok(value)
    }
}
pub(super) fn resolve(
    association: &SourceObjectAssociation,
    metadata: &metadata::Metadata,
    cache: &mut BTreeMap<String, usize>,
    scene: &mut SceneTables,
) -> Result<usize> {
    let index = metadata.material_index(association)?;
    let color = association
        .color
        .map(|c| [c.r, c.g, c.b, c.a])
        .unwrap_or([0.8, 0.8, 0.8, 1.0]);
    let key = if index >= 0 {
        format!("material-{index}")
    } else {
        format!("object-{}-{color:?}", association.object_id)
    };
    if let Some(rank) = cache.get(&key) {
        return Ok(*rank);
    }
    let material = if index >= 0 {
        metadata
            .materials
            .get(&index)
            .ok_or_else(|| source::invalid("3dm", "assigned material absent from table"))?
            .json(scene)?
    } else {
        source::material(&key, source::linear_color(color))
    };
    let rank = scene.materials.len();
    scene.materials.push(material);
    cache.insert(key, rank);
    Ok(rank)
}
