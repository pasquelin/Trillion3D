//! Autodesk 3DS static EDIT3DS chunks, from the published little-endian chunk grammar.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
use std::collections::BTreeMap;
mod chunks;
mod materials;
mod mesh;
#[cfg(test)]
mod tests;
use chunks::Reader;
pub(super) static THREEDS: source::FilePlugin = source::FilePlugin {
    name: "3ds",
    version: "3ds-static-chunks-1",
    extensions: &["3ds"],
    magic: &[0x4d, 0x4d],
    read,
};
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let mut file = Reader::new(bytes);
    let (id, data) = file.chunk()?;
    if id != 0x4d4d || !file.empty() {
        return Err(source::invalid("3ds", "expected one MAIN3DS chunk"));
    }
    let mut main = Reader::new(data);
    let mut edit = None;
    while !main.empty() {
        let (id, data) = main.chunk()?;
        match id {
            0x0002 => {}
            0x3d3d => {
                if edit.replace(data).is_some() {
                    return Err(source::invalid("3ds", "duplicate editor chunk"));
                }
            }
            0xb000 => return Err(source::unsupported("3ds", "keyframe hierarchy/animation")),
            _ => return Err(source::unsupported("3ds", format!("main chunk {id:04x}"))),
        }
    }
    let mut editor =
        Reader::new(edit.ok_or_else(|| source::invalid("3ds", "missing editor chunk"))?);
    let mut objects = Vec::new();
    let mut names = BTreeMap::new();
    let mut scale = 1.;
    while !editor.empty() {
        let (id, data) = editor.chunk()?;
        match id {
            0x3d3e => {}
            0x0100 => {
                let mut r = Reader::new(data);
                scale = r.float()?;
                r.finish()?;
                if scale <= 0. {
                    return Err(source::invalid("3ds", "nonpositive master scale"));
                }
            }
            0xafff => {
                let (name, material) = materials::read(data)?;
                let rank = scene.materials.len();
                if names.insert(name, rank).is_some() {
                    return Err(source::invalid("3ds", "duplicate material name"));
                }
                scene.materials.push(material);
            }
            0x4000 => objects.push(data),
            _ => return Err(source::unsupported("3ds", format!("editor chunk {id:04x}"))),
        }
    }
    let mut children = Vec::new();
    for object in objects {
        super::cancel::stopped(request.cancelled, 0)
            .then(super::cancel::refusal)
            .map_or(Ok(()), Err)?;
        children.push(mesh::read(object, &names, request, scene)?);
    }
    scene.node(json!({"name":"3DS coordinate system","matrix":[scale,0.,0.,0.,0.,0.,-scale,0.,0.,scale,0.,0.,0.,0.,0.,1.],"children":children}));
    Ok(())
}
