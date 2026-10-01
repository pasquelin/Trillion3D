//! 3MF Core model packages: indexed meshes, named base materials, components and build items.
//! ZIP is read in place with bounded decompression; no package path is written to disk.
use super::{mesh_source as source, mesh_source::xml, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use roxmltree::Node;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
mod materials;
mod mesh;
mod model;
mod package;
#[cfg(test)]
mod tests;
pub(super) static THREEMF: source::FilePlugin = source::FilePlugin {
    name: "3mf",
    version: "3mf-core-material-1",
    extensions: &["3mf"],
    magic: b"",
    read,
};
const CORE: &str = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MATERIALS: &str = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let model = package::model(bytes, request)?;
    let document = xml::parse(&model, request, "3mf")?;
    model::read(document.root_element(), request, scene)
}
fn number(node: Node<'_, '_>, attribute: &str) -> Result<f64> {
    node.attribute(attribute)
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .ok_or_else(|| source::invalid("3mf", format!("missing/non-finite {attribute}")))
}
fn optional_index(node: Node<'_, '_>, name: &str) -> Result<Option<usize>> {
    node.attribute(name)
        .map(|v| {
            v.parse::<usize>()
                .map_err(|_| source::invalid("3mf", format!("invalid {name}")))
        })
        .transpose()
}
