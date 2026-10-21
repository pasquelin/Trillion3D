//! A source mesh read from the glTF binary: every triangle primitive with its material, texture
//! coordinates, vertex normals and vertex colours, in object space.
use super::material::Surface;
use super::mesh::{Corners, Traceable};
use crate::compiler::accessor::create::accessor;
use crate::compiler::primitive::triangles::{mesh_primitives, read};
use crate::compiler::validate::required_index;
use crate::texture::TexturePreview;
use crate::Result;
use serde_json::Value;

impl Traceable {
    /// Reads mesh `mesh` of `g` from `bin`: every triangle primitive, as declared.
    pub fn read(g: &Value, bin: &[u8], mesh: usize, previews: &[TexturePreview]) -> Result<Self> {
        let (mut triangles, mut tags, mut corners, mut surfaces) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        // Primitives sharing a material share its surface: its texels are copied once.
        let mut materials: Vec<Option<u64>> = Vec::new();
        let mut ranges = Vec::new();
        for (index, primitive) in mesh_primitives(g, mesh)? {
            let first = tags.len();
            let attribute = |name: &str| -> Result<Option<Vec<f32>>> {
                let Some(id) = primitive.pointer(&format!("/attributes/{name}")) else {
                    return Ok(None);
                };
                Ok(Some(
                    accessor(g, bin, required_index(Some(id), name)?, None)?.collect_f32()?,
                ))
            };
            let (positions, indices, _) = read(g, bin, primitive, None)?;
            let positions = positions.collect_f32()?;
            let normals = attribute("NORMAL")?;
            let sets = [attribute("TEXCOORD_0")?, attribute("TEXCOORD_1")?];
            let colours = attribute("COLOR_0")?;
            // A colour is three or four wide, as its accessor declares.
            let width = colours
                .as_ref()
                .map_or(4, |c| c.len() / (positions.len() / 3).max(1));
            let id = primitive.get("material").and_then(Value::as_u64);
            let material = materials
                .iter()
                .position(|&of| of == id)
                .unwrap_or_else(|| {
                    surfaces.push(Surface::of(g, id, previews));
                    materials.push(id);
                    materials.len() - 1
                }) as u32;
            for triangle in indices.as_chunks::<3>().0 {
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
            ranges.push((index, first..tags.len()));
        }
        let mut read = Self::new(triangles, tags, corners, surfaces);
        read.primitives = ranges;
        Ok(read)
    }
}
