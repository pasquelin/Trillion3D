//! Core base materials keep their resource/property IDs; colour groups become vertex RGBA.
use super::*;
pub(super) enum Group {
    Bases(Vec<usize>),
    Colors(Vec<[f32; 4]>, usize),
}
pub(super) type Groups = BTreeMap<usize, Group>;
type TriangleAppearance = (Option<usize>, Option<[[f32; 4]; 3]>);
fn color(value: &str) -> Result<[f32; 4]> {
    let hex = value
        .strip_prefix('#')
        .ok_or_else(|| source::invalid("3mf", "colour lacks#"))?;
    if ![6, 8].contains(&hex.len()) || !hex.is_ascii() {
        return Err(source::invalid(
            "3mf",
            "colour needs6 or8 hexadecimal digits",
        ));
    }
    let mut out = [1.; 4];
    for (axis, digits) in hex.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        out[axis] = u8::from_str_radix(std::str::from_utf8(digits).unwrap(), 16)
            .map_err(|_| source::invalid("3mf", "invalid colour"))? as f32
            / 255.;
    }
    Ok(source::linear_color(out))
}
pub(super) fn load(resources: Node<'_, '_>, scene: &mut SceneTables) -> Result<Groups> {
    let mut groups = Groups::new();
    for group in resources.children().filter(|n| n.is_element()) {
        let kind = group.tag_name().name();
        if kind == "object" {
            continue;
        }
        let id = xml::usize_attribute(group, "id", "3mf")?;
        let values = match (group.tag_name().namespace(), kind) {
            (Some(CORE), "basematerials") => {
                let mut ranks = Vec::new();
                for base in group.children().filter(|n| n.is_element()) {
                    if !base.has_tag_name("base") {
                        return Err(source::unsupported("3mf", base.tag_name().name()));
                    }
                    let rgba = color(
                        base.attribute("displaycolor")
                            .ok_or_else(|| source::invalid("3mf", "base has no displaycolor"))?,
                    )?;
                    let name = base
                        .attribute("name")
                        .ok_or_else(|| source::invalid("3mf", "base has no name"))?;
                    ranks.push(scene.materials.len());
                    scene.materials.push(source::material(name, rgba));
                }
                Group::Bases(ranks)
            }
            (Some(MATERIALS), "colorgroup") => {
                let mut colors = Vec::new();
                for item in group.children().filter(|n| n.is_element()) {
                    if !item.has_tag_name("color") {
                        return Err(source::unsupported("3mf", item.tag_name().name()));
                    }
                    colors.push(color(item.attribute("color").unwrap_or(""))?);
                }
                let rank = scene.materials.len();
                scene
                    .materials
                    .push(source::material(&format!("colour-group-{id}"), [1.; 4]));
                if colors.iter().any(|c| c[3] < 1.) {
                    scene.materials[rank]["alphaMode"] = json!("BLEND");
                }
                Group::Colors(colors, rank)
            }
            _ => return Err(source::unsupported("3mf", format!("resource {kind}"))),
        };
        if groups.insert(id, values).is_some() {
            return Err(source::invalid("3mf", "duplicate property resource ID"));
        }
    }
    Ok(groups)
}
pub(super) fn triangle(
    groups: &Groups,
    object: Node<'_, '_>,
    triangle: Node<'_, '_>,
) -> Result<TriangleAppearance> {
    let pid = optional_index(triangle, "pid")?.or(optional_index(object, "pid")?);
    let p1 = optional_index(triangle, "p1")?.or(optional_index(object, "pindex")?);
    let Some(pid) = pid else {
        if p1.is_some() || triangle.attribute("p2").is_some() || triangle.attribute("p3").is_some()
        {
            return Err(source::invalid("3mf", "property index without resource"));
        }
        return Ok((None, None));
    };
    let first = p1.ok_or_else(|| source::invalid("3mf", "property resource without index"))?;
    let indices = [
        first,
        optional_index(triangle, "p2")?.unwrap_or(first),
        optional_index(triangle, "p3")?.unwrap_or(first),
    ];
    match groups
        .get(&pid)
        .ok_or_else(|| source::invalid("3mf", "unknown property resource"))?
    {
        Group::Bases(materials) => {
            if indices.iter().any(|v| *v != first) {
                return Err(source::unsupported(
                    "3mf",
                    "interpolated base material identities",
                ));
            }
            Ok((
                Some(
                    *materials
                        .get(first)
                        .ok_or_else(|| source::invalid("3mf", "base property out of range"))?,
                ),
                None,
            ))
        }
        Group::Colors(colors, material) => {
            let mut result = [[0.; 4]; 3];
            for (into, index) in result.iter_mut().zip(indices) {
                *into = *colors
                    .get(index)
                    .ok_or_else(|| source::invalid("3mf", "colour property out of range"))?;
            }
            Ok((Some(*material), Some(result)))
        }
    }
}
