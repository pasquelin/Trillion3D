//! A source mesh read from the glTF binary: every triangle primitive with its material, texture
//! coordinates, vertex normals and vertex colours, in object space.
use super::mesh::{Corners, Traceable};
use super::surface::Surface;
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::required_index;
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;

impl Traceable {
    /// Reads mesh `mesh` of `g` from `bin`: every triangle primitive, as declared.
    pub fn read(g: &Value, bin: &[u8], mesh: usize, previews: &[TexturePreview]) -> Result<Self> {
        let (mut triangles, mut tags, mut corners, mut surfaces) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let empty = Vec::new();
        let primitives = g
            .pointer(&format!("/meshes/{mesh}/primitives"))
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        for primitive in primitives {
            if primitive.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
                continue;
            }
            let attribute = |name: &str| -> Result<Option<Vec<f32>>> {
                let Some(id) = primitive.pointer(&format!("/attributes/{name}")) else {
                    return Ok(None);
                };
                Ok(Some(
                    accessor(g, bin, required_index(Some(id), name)?, None)?.collect_f32()?,
                ))
            };
            let positions = attribute("POSITION")?.unwrap_or_default();
            let normals = attribute("NORMAL")?;
            let sets = [attribute("TEXCOORD_0")?, attribute("TEXCOORD_1")?];
            let colours = attribute("COLOR_0")?;
            // A colour is three or four wide, as its accessor declares.
            let width = colours
                .as_ref()
                .map_or(4, |c| c.len() / (positions.len() / 3).max(1));
            let indices: Vec<u32> = match primitive.get("indices") {
                Some(id) => {
                    accessor(g, bin, required_index(Some(id), "indices")?, None)?.collect_u32()?
                }
                None => (0..positions.len() as u32 / 3).collect(),
            };
            let material = surfaces.len() as u32;
            surfaces.push(Surface::of(
                g,
                primitive.get("material").and_then(Value::as_u64),
                previews,
            ));
            // A corner outside POSITION leaves its triangle out, never a vertex at the origin.
            let inside = |t: &&[u32; 3]| t.iter().all(|&i| (i as usize + 1) * 3 <= positions.len());
            for triangle in indices.as_chunks::<3>().0.iter().filter(inside) {
                let mut corner = Corners::default();
                let mut normal = [0.0f32; 9];
                let mut colour = [1.0f32; 12];
                for (k, &index) in triangle.iter().enumerate() {
                    let i = index as usize;
                    triangles.extend_from_slice(&positions[i * 3..i * 3 + 3]);
                    for (set, uv) in sets.iter().enumerate() {
                        let read = uv.as_ref().and_then(|uv| uv.get(i * 2..i * 2 + 2));
                        corner.uv[set][k * 2..k * 2 + 2].copy_from_slice(read.unwrap_or(&[0.0; 2]));
                    }
                    if let Some(n) = normals.as_ref().and_then(|n| n.get(i * 3..i * 3 + 3)) {
                        normal[k * 3..k * 3 + 3].copy_from_slice(n);
                    }
                    let read = colours.as_ref().filter(|_| matches!(width, 3 | 4));
                    if let Some(c) = read.and_then(|c| c.get(i * width..i * width + width)) {
                        colour[k * 4..k * 4 + width].copy_from_slice(c);
                    }
                }
                corner.normals = normals.is_some().then_some(normal);
                corner.colours = colours.is_some().then_some(colour);
                corners.push(corner);
                tags.push(material);
            }
        }
        Ok(Self::new(triangles, tags, corners, surfaces))
    }
}
