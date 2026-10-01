//! Rhino mesh scenes through the bounded Apache-2.0 cadmpeg decoder.
//! Exact CAD carriers without a supported display mesh are refused, never silently omitted.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use cadmpeg_ir::transform::Transform;
use cadmpeg_ir::{CadIr, SourceObjectAssociation};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
mod decode;
#[cfg(test)]
mod integrity_tests;
mod materials;
mod metadata;
mod surface;
#[cfg(test)]
mod tests;

pub(super) static RHINO: source::FilePlugin = source::FilePlugin {
    name: "rhino",
    version: "rhino-cadmpeg-0.5.5-mesh-1",
    extensions: &["3dm"],
    magic: b"3D Geometry File Format ",
    read,
};
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let decoded = decode::read(bytes, request)?;
    let ir = decoded.ir();
    // A point/curve/B-rep disappearing beside a mesh would be a partial scene success.
    if !ir.model.bodies.is_empty()
        || !ir.model.surfaces.is_empty()
        || !ir.model.curves.is_empty()
        || !ir.model.points.is_empty()
        || !ir.model.subds.is_empty()
    {
        return Err(source::unsupported(
            "3dm",
            "exact CAD/curve/point geometry without supported mesh-only representation",
        ));
    }
    for loss in &decoded.report().losses {
        scene
            .report
            .add(&format!("rhino-{}", loss.code.local_code()));
    }
    let metadata = metadata::Metadata::read(ir, request)?;
    surface::emit(ir, &metadata, request, scene)
}
