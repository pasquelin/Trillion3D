//! COMMON material identity and bindings. Unsupported shader data is explicitly refused.
use super::*;
mod texture;
fn colour(node: Node<'_, '_>) -> Result<[f32; 4]> {
    let values = xml::numbers(node, "collada")?;
    let values: [f64; 4] = values
        .try_into()
        .map_err(|_| source::invalid("collada", "colour needs4 components"))?;
    let mut out = [0.; 4];
    for (into, value) in out.iter_mut().zip(values) {
        if !(0.0..=1.0).contains(&value) {
            return Err(source::invalid("collada", "colour outside[0,1]"));
        }
        *into = value as f32;
    }
    Ok(out)
}
fn amount(node: Node<'_, '_>, name: &str, default: f64) -> Result<f64> {
    let Some(value) = xml::child(node, name) else {
        return Ok(default);
    };
    let numbers = xml::numbers(xml::required(value, "float", "collada")?, "collada")?;
    let [value] = numbers.as_slice() else {
        return Err(source::invalid("collada", "expected a scalar"));
    };
    Ok(*value)
}
fn effect(
    world: &mut World<'_, '_, '_>,
    effect: Node<'_, '_>,
    name: &str,
) -> Result<serde_json::Value> {
    let profile = xml::required(effect, "profile_COMMON", "collada")?;
    let technique = xml::required(profile, "technique", "collada")?;
    let shader = technique
        .children()
        .find(|n| n.is_element())
        .ok_or_else(|| source::invalid("collada", "missing material shader"))?;
    if !["lambert", "phong", "blinn"].contains(&shader.tag_name().name()) {
        return Err(source::unsupported(
            "collada",
            format!("shader {}", shader.tag_name().name()),
        ));
    }
    for name in ["ambient", "specular", "reflective"] {
        if let Some(channel) = xml::child(shader, name) {
            let values = xml::child(channel, "color").map(colour).transpose()?;
            if values.is_none_or(|v| v[..3].iter().any(|x| *x != 0.0)) {
                return Err(source::unsupported(
                    "collada",
                    format!("nonzero/unrepresentable {name} material channel"),
                ));
            }
        }
    }
    if amount(shader, "reflectivity", 0.)? != 0. || amount(shader, "index_of_refraction", 1.)? != 1.
    {
        return Err(source::unsupported(
            "collada",
            "reflective or refractive COMMON material",
        ));
    }
    let diffuse = xml::child(shader, "diffuse");
    let mut base = diffuse
        .and_then(|n| xml::child(n, "color"))
        .map(colour)
        .transpose()?
        .unwrap_or([1.; 4]);
    let transparency = amount(shader, "transparency", 1.)?;
    if !(0.0..=1.0).contains(&transparency) {
        return Err(source::invalid("collada", "transparency outside[0,1]"));
    }
    if let Some(transparent) = xml::child(shader, "transparent") {
        let color = colour(xml::required(transparent, "color", "collada")?)?;
        let rgb =
            0.212671 * color[0] as f64 + 0.715160 * color[1] as f64 + 0.072169 * color[2] as f64;
        base[3] *= match transparent.attribute("opaque").unwrap_or("A_ONE") {
            "A_ONE" => color[3] as f64 * transparency,
            "A_ZERO" => 1. - color[3] as f64 * transparency,
            "RGB_ZERO" => 1. - rgb * transparency,
            "RGB_ONE" => rgb * transparency,
            _ => {
                return Err(source::unsupported(
                    "collada",
                    "unknown transparent opaque mode",
                ))
            }
        } as f32;
    } else {
        base[3] *= transparency as f32;
    }
    let mut material = source::material(name, base);
    if let Some(texture) = diffuse.and_then(|n| xml::child(n, "texture")) {
        let rank = texture::load(world, profile, texture)?;
        material["pbrMetallicRoughness"]["baseColorTexture"] = json!({"index":rank});
    }
    if let Some(emission) = xml::child(shader, "emission") {
        let value = colour(xml::required(emission, "color", "collada")?)?;
        material["emissiveFactor"] = json!(&value[..3]);
    }
    for extra in effect
        .descendants()
        .filter(|n| n.has_tag_name("double_sided"))
    {
        if extra.text().is_some_and(|v| v.trim() == "1") {
            material["doubleSided"] = json!(true);
        }
    }
    Ok(material)
}
pub(super) fn load<'a, 'd, 'r>(world: &mut World<'a, 'd, 'r>, root: Node<'a, 'd>) -> Result<()> {
    let Some(library) = xml::child(root, "library_materials") else {
        return Ok(());
    };
    for material in library.children().filter(|n| n.has_tag_name("material")) {
        let id = material
            .attribute("id")
            .ok_or_else(|| source::invalid("collada", "material without id"))?;
        let reference = xml::required(material, "instance_effect", "collada")?;
        if reference.children().any(|n| n.has_tag_name("setparam")) {
            return Err(source::unsupported("collada", "instance_effect setparam"));
        }
        let source_effect = world.lookup(reference.attribute("url").unwrap_or(""))?;
        let converted = effect(
            world,
            source_effect,
            material.attribute("name").unwrap_or(id),
        )?;
        world.materials.insert(id, world.scene.materials.len());
        world.scene.materials.push(converted);
    }
    Ok(())
}
