//! VRML97 static scene import; unsupported dynamic or external semantics fail by name.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
use std::collections::BTreeMap;
mod attributes;
#[cfg(test)]
mod attributes_tests;
mod document;
mod fields;
mod geometry;
mod lines;
mod material;
mod placement;
mod smoothing;
#[cfg(test)]
mod tests;
mod texture;
pub(super) static VRML: source::FilePlugin = source::FilePlugin {
    name: "vrml",
    version: "vrml97-1",
    extensions: &["wrl", "vrml"],
    magic: b"#VRML",
    read,
};
struct Reader<'a, 'b> {
    document: document::Document,
    request: &'a SceneRequest<'b>,
    meshes: BTreeMap<usize, usize>,
    materials: BTreeMap<String, usize>,
    payload: usize,
}
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let document = document::parse(bytes, request)?;
    let roots = document.roots.clone();
    let mut reader = Reader {
        document,
        request,
        meshes: BTreeMap::new(),
        materials: BTreeMap::new(),
        payload: 0,
    };
    for root in roots {
        reader.place(root, &mut Vec::new(), scene)?;
    }
    Ok(())
}
