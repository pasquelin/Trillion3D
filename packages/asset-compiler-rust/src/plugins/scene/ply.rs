//! Stanford PLY 1.0: ASCII and both binary byte orders, read from its published grammar.
//! Geometry, authored normals/UVs/colours and indexed materials retain source order.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
mod header;
mod schema;
mod surface;
#[cfg(test)]
mod tests;
mod values;
use header::{Element, Property, Scalar};

pub(super) static PLY: source::FilePlugin = source::FilePlugin {
    name: "ply",
    version: "ply-1.0-surface-1",
    extensions: &["ply"],
    magic: b"ply",
    read,
};

fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let (format, elements, start) = header::read(bytes)?;
    let mut reader = values::Reader::new(&bytes[start..], format)?;
    let mut surface = surface::Surface::default();
    for element in &elements {
        source::admit(
            element.count.saturating_mul(256),
            request.ram_budget / 2,
            "ply",
        )?;
        for index in 0..element.count {
            if super::cancel::stopped(request.cancelled, index) {
                return Err(super::cancel::refusal());
            }
            surface.record(element, &mut reader, request.ram_budget)?;
        }
    }
    reader.finish()?;
    surface.emit(scene, request)
}
