//! The existing metallic/roughness scene contract carries VRML's diffuse, emissive and opacity.
use super::*;
pub(super) fn appearance(
    id: Option<usize>,
    document: &document::Document,
    scene: &mut SceneTables,
    request: &SceneRequest<'_>,
    lines: bool,
) -> Result<usize> {
    let material = if let Some(id) = id {
        let appearance = &document.nodes[id];
        if appearance.kind != "Appearance" {
            return Err(source::invalid("vrml", "expected Appearance"));
        }
        appearance.fields(&["material", "texture", "textureTransform"])?;
        appearance.child("material")?
    } else {
        None
    };
    let mut surface = source::material("VRML material", [0.8, 0.8, 0.8, 1.]);
    if let Some(id) = material {
        let m = &document.nodes[id];
        if m.kind != "Material" {
            return Err(source::invalid("vrml", "expected Material"));
        }
        m.fields(&[
            "diffuseColor",
            "emissiveColor",
            "specularColor",
            "ambientIntensity",
            "shininess",
            "transparency",
        ])?;
        let rgb = m.number_array("diffuseColor", [0.8; 3])?;
        let emissive = m.number_array("emissiveColor", [0.; 3])?;
        let specular = m.number_array("specularColor", [0.; 3])?;
        let [alpha] = m.number_array("transparency", [0.])?;
        let [shininess] = m.number_array("shininess", [0.2])?;
        let [ambient] = m.number_array("ambientIntensity", [0.2])?;
        if rgb
            .into_iter()
            .chain(emissive)
            .chain(specular)
            .chain([alpha, shininess, ambient])
            .any(|v| !(0. ..=1.).contains(&v))
        {
            return Err(source::invalid("vrml", "material component outside [0,1]"));
        }
        surface = source::material(
            m.name.as_deref().unwrap_or("VRML material"),
            [
                rgb[0] as f32,
                rgb[1] as f32,
                rgb[2] as f32,
                (1. - alpha) as f32,
            ],
        );
        surface["emissiveFactor"] = json!(emissive);
        surface["pbrMetallicRoughness"]["roughnessFactor"] =
            json!((2. / (128. * shininess + 2.)).sqrt());
        surface["extensions"] = json!({"KHR_materials_specular":{"specularColorFactor":specular}});
        surface["extras"] = json!({"vrmlAmbientIntensity":ambient,"vrmlShininess":shininess});
    }
    if let Some(id) = id.filter(|_| !lines) {
        super::texture::attach(id, document, request, scene, &mut surface)?;
    }
    let rank = scene.materials.len();
    scene.materials.push(surface);
    Ok(rank)
}

/// Share authored Material identity only where texture bindings and geometry overrides agree.
pub(super) fn key(
    id: Option<usize>,
    document: &document::Document,
    geometry: &document::Node,
) -> Result<String> {
    let appearance = id.map(|id| &document.nodes[id]);
    let mut bindings = Vec::new();
    for name in ["material", "texture", "textureTransform"] {
        bindings.push(
            appearance
                .map(|node| node.child(name))
                .transpose()?
                .flatten(),
        );
    }
    Ok(format!(
        "{bindings:?}/{}/{}/{}",
        geometry.kind == "IndexedLineSet",
        geometry.boolean("solid", true)?,
        geometry.child("color")?.is_some()
    ))
}
