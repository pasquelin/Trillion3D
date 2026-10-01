//! MagicaVoxel 150/200 chunks, from ephtracy's published VOX grammar.
//! Sparse voxel surfaces reuse the common scene tables; instances retain mesh identity.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
mod chunks;
mod graph;
#[cfg(test)]
mod invalid_tests;
mod palette;
mod reader;
mod surface;
#[cfg(test)]
mod tests;
use reader::{Budget, Dict, Reader};

pub(super) static VOX: source::FilePlugin = source::FilePlugin {
    name: "vox",
    version: "vox-150-200-surface-1",
    extensions: &["vox"],
    magic: b"VOX ",
    read,
};
struct Model {
    size: [u32; 3],
    voxels: Vec<[u8; 4]>,
}
#[derive(Default)]
struct Document {
    models: Vec<Model>,
    size: Option<[u32; 3]>,
    palette: Option<[[u8; 4]; 256]>,
    materials: BTreeMap<u32, Dict>,
    nodes: BTreeMap<i32, graph::Node>,
    layers: BTreeMap<i32, Dict>,
    pack: Option<u32>,
    budget: Budget,
}
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != b"VOX " {
        return Err(source::invalid("vox", "missing signature"));
    }
    let version = reader.u32()?;
    if !matches!(version, 150 | 200) {
        return Err(source::unsupported("vox", format!("version {version}")));
    }
    if reader.take(4)? != b"MAIN" || reader.u32()? != 0 {
        return Err(source::invalid("vox", "expected empty MAIN"));
    }
    let length = reader.u32()? as usize;
    let chunks = reader.take(length)?;
    reader.finish()?;
    let mut doc = Document {
        budget: Budget::new(request.ram_budget / 2),
        ..Document::default()
    };
    chunks::read(chunks, request, scene, &mut doc)?;
    if doc.size.is_some()
        || doc.models.is_empty()
        || doc.pack.is_some_and(|n| n as usize != doc.models.len())
    {
        return Err(source::invalid(
            "vox",
            "unpaired SIZE or inconsistent model count",
        ));
    }
    doc.budget.charge(256 * 1024)?;
    let materials = palette::emit(&doc, scene)?;
    let mut meshes = Vec::new();
    for (index, model) in doc.models.iter().enumerate() {
        meshes.push(surface::emit(model, index, &materials, request, scene)?);
    }
    graph::emit(&doc, &meshes, request, scene)
}
