//! COLLADA 1.4/1.5 static polygon scenes, decoded from Khronos' XML specification.
//! Geometry is instanced through the existing glTF tables, with source units and hierarchy.
use super::{mesh_source as source, mesh_source::xml, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use roxmltree::Node;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
mod geometry;
mod inputs;
mod materials;
mod nodes;
#[cfg(test)]
mod tests;

pub(super) static COLLADA: source::FilePlugin = source::FilePlugin {
    name: "collada",
    version: "collada-static-1",
    extensions: &["dae"],
    magic: b"<COLLADA",
    read,
};
struct World<'a, 'd, 'r> {
    ids: BTreeMap<&'a str, Node<'a, 'd>>,
    materials: BTreeMap<&'a str, usize>,
    meshes: BTreeMap<String, usize>,
    scene: &'r mut SceneTables,
    request: &'r SceneRequest<'r>,
}
impl<'a, 'd, 'r> World<'a, 'd, 'r> {
    fn lookup(&self, uri: &str) -> Result<Node<'a, 'd>> {
        let id = xml::fragment(uri, "collada")?;
        self.ids
            .get(id)
            .copied()
            .ok_or_else(|| source::invalid("collada", format!("missing reference {uri}")))
    }
}
pub(super) fn read(
    bytes: &[u8],
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let document = xml::parse(bytes, request, "collada")?;
    let root = document.root_element();
    if root.tag_name().name() != "COLLADA"
        || !matches!(root.attribute("version"), Some("1.4.0" | "1.4.1" | "1.5.0"))
    {
        return Err(source::unsupported(
            "collada",
            "expected COLLADA version1.4 or1.5",
        ));
    }
    for name in [
        "library_controllers",
        "library_animations",
        "library_physics_models",
        "library_physics_scenes",
    ] {
        if xml::child(root, name).is_some_and(|n| n.children().any(|n| n.is_element())) {
            return Err(source::unsupported("collada", name));
        }
    }
    let mut ids = BTreeMap::new();
    for node in root.descendants().filter(|n| n.is_element()) {
        if let Some(id) = node.attribute("id") {
            if ids.insert(id, node).is_some() {
                return Err(source::invalid("collada", format!("duplicate id {id}")));
            }
        }
    }
    let mut world = World {
        ids,
        materials: BTreeMap::new(),
        meshes: BTreeMap::new(),
        scene,
        request,
    };
    materials::load(&mut world, root)?;
    let selected = xml::required(
        xml::required(root, "scene", "collada")?,
        "instance_visual_scene",
        "collada",
    )?;
    let visual = world.lookup(selected.attribute("url").unwrap_or(""))?;
    if visual.tag_name().name() != "visual_scene" {
        return Err(source::invalid(
            "collada",
            "scene reference is not a visual_scene",
        ));
    }
    let mut children = Vec::new();
    for node in visual.children().filter(|n| n.has_tag_name("node")) {
        children.push(nodes::emit(&mut world, node, 0)?);
    }
    let matrix = nodes::root_matrix(root)?;
    world
        .scene
        .node(json!({"name":"COLLADA coordinate system","matrix":matrix,"children":children}));
    Ok(())
}
