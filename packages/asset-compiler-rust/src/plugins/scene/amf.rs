//! AMF 1.1 XML: indexed triangle volumes, physical units, colours and constellations.
use super::{mesh_source as source, SceneRequest};
use crate::{import::SceneTables, Result};
use roxmltree::Node;
use serde_json::json;
use source::xml;
use std::collections::BTreeMap;
mod geometry;
mod placements;
#[cfg(test)]
mod tests;

pub(super) static AMF: source::FilePlugin = source::FilePlugin {
    name: "amf",
    version: "amf-xml-1",
    extensions: &["amf"],
    magic: b"",
    read,
};

fn value(node: Node<'_, '_>) -> Result<f64> {
    let values = xml::numbers(node, "amf")?;
    if values.len() != 1 {
        return Err(source::invalid("amf", "expected one numeric value"));
    }
    Ok(values[0])
}
fn component(node: Node<'_, '_>, name: &str, fallback: Option<f64>) -> Result<f64> {
    match xml::child(node, name) {
        Some(child) => value(child),
        None => fallback.ok_or_else(|| source::invalid("amf", format!("missing {name}"))),
    }
}
fn color(node: Node<'_, '_>) -> Result<Option<[f32; 4]>> {
    let Some(color) = xml::child(node, "color") else {
        return Ok(None);
    };
    let values = [
        component(color, "r", None)?,
        component(color, "g", None)?,
        component(color, "b", None)?,
        component(color, "a", Some(1.0))?,
    ];
    if values.iter().any(|v| !(0.0..=1.0).contains(v)) {
        return Err(source::invalid("amf", "colour component outside [0,1]"));
    }
    Ok(Some(values.map(|v| v as f32)))
}
fn elements<'a, 'd>(node: Node<'a, 'd>, name: &'a str) -> impl Iterator<Item = Node<'a, 'd>> {
    node.children()
        .filter(move |child| child.is_element() && child.tag_name().name() == name)
}
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    if bytes.starts_with(b"PK") {
        return Err(source::unsupported("amf", "ZIP-compressed AMF"));
    }
    let document = xml::parse(bytes, request, "amf")?;
    let root = document.root_element();
    if root.tag_name().name() != "amf" {
        return Err(source::invalid("amf", "missing amf root"));
    }
    let unit = match root.attribute("unit").unwrap_or("millimeter") {
        "millimeter" => 0.001,
        "meter" => 1.0,
        "micron" => 0.000001,
        "inch" => 0.0254,
        "feet" => 0.3048,
        other => return Err(source::unsupported("amf", format!("unit {other}"))),
    };
    if !matches!(root.attribute("version").unwrap_or("1.1"), "1.0" | "1.1") {
        return Err(source::unsupported("amf", "AMF version"));
    }
    // Curves, textures, equations and composites require interpretation; never flatten silently.
    for node in root.descendants().filter(|node| node.is_element()) {
        if node.tag_name().namespace() != root.tag_name().namespace()
            || ![
                "amf",
                "metadata",
                "object",
                "mesh",
                "vertices",
                "vertex",
                "coordinates",
                "x",
                "y",
                "z",
                "color",
                "r",
                "g",
                "b",
                "a",
                "volume",
                "triangle",
                "v1",
                "v2",
                "v3",
                "material",
                "constellation",
                "instance",
                "deltax",
                "deltay",
                "deltaz",
                "rx",
                "ry",
                "rz",
            ]
            .contains(&node.tag_name().name())
        {
            return Err(source::unsupported("amf", node.tag_name().name()));
        }
    }
    let mut materials = BTreeMap::new();
    for material in elements(root, "material") {
        let id = xml::usize_attribute(material, "id", "amf")?;
        let color = color(material)?.unwrap_or([1.0; 4]);
        let rank = scene.materials.len();
        scene
            .materials
            .push(source::material(&format!("material-{id}"), color));
        if materials.insert(id, (rank, color)).is_some() {
            return Err(source::invalid("amf", "duplicate material id"));
        }
    }
    let mut objects = BTreeMap::new();
    let mut payload = 0usize;
    for object in elements(root, "object") {
        super::archive::check(request)?;
        let id = xml::usize_attribute(object, "id", "amf")?;
        let rank = geometry::object(object, unit, &materials, request, scene, &mut payload)?;
        if objects.insert(id, rank).is_some() {
            return Err(source::invalid("amf", "duplicate object id"));
        }
    }
    if objects.is_empty() {
        return Err(source::invalid("amf", "no objects"));
    }
    placements::place(root, unit, &objects, request, scene)
}
