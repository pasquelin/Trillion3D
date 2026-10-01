//! STL (ASCII and little-endian binary), read from the public 3D Systems grammar.
//! Facet order, solid names and VisCAM/Magics colours are retained; no external parser.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
mod ascii;
mod binary;
#[cfg(test)]
mod tests;

pub(super) static STL: source::FilePlugin = source::FilePlugin {
    name: "stl",
    version: "stl-ascii-binary-1",
    extensions: &["stl"],
    magic: b"solid ",
    read,
};

type Color = [f32; 4];
struct Solid {
    name: String,
    parts: Vec<(Vertices, Option<usize>)>,
}
impl Solid {
    fn new(name: String) -> Self {
        Self {
            name,
            parts: Vec::new(),
        }
    }
    fn facet(&mut self, values: [[f32; 3]; 4], material: Option<usize>) -> Result<()> {
        if self.parts.last().is_none_or(|part| part.1 != material) {
            self.parts.push((Vertices::default(), material));
        }
        let out = &mut self.parts.last_mut().unwrap().0;
        use crate::shared_math::{cross, sub, unit};
        let [written, a, b, c] = values.map(|v| v.map(f64::from));
        let normal = unit(written)
            .or_else(|| unit(cross(sub(b, a), sub(c, a))))
            .unwrap_or([0.0; 3]);
        for point in &values[1..] {
            out.indices.push(
                u32::try_from(out.count())
                    .map_err(|_| source::invalid("stl", "too many corners"))?,
            );
            out.positions.extend_from_slice(point);
            out.normals.extend(normal.map(|v| v as f32));
        }
        Ok(())
    }
    fn emit(self, scene: &mut SceneTables, request: &SceneRequest<'_>) -> Result<()> {
        if self.parts.is_empty() {
            return Err(source::invalid("stl", "solid has no facets"));
        }
        let mesh = source::mesh_bounded(scene, &self.name, &self.parts, request)?;
        scene.node(json!({"name":self.name,"mesh":mesh}));
        Ok(())
    }
}

fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    if bytes.len() >= 84 {
        let count = u32::from_le_bytes(bytes[80..84].try_into().unwrap()) as usize;
        if count.checked_mul(50).and_then(|n| n.checked_add(84)) == Some(bytes.len()) {
            return binary::read(bytes, count, request, scene);
        }
    }
    ascii::read(bytes, request, scene)
}
