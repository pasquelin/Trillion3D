//! A source mesh read from the glTF binary: every triangle primitive with its material, texture
//! coordinates, vertex normals and vertex colours, in object space — or, for a primitive whose
//! displacement was baked into its triangles (`displace`), from the baked mesh, the triangles its
//! build holds.
use super::material::Surface;
use super::mesh::{Corners, Traceable};
use crate::compiler::accessor::create::accessor;
use crate::compiler::primitive::triangles::{mesh_primitives, read};
use crate::compiler::validate::required_index;
use crate::displace::Baked;
use crate::texture::TexturePreview;
use crate::Result;
use serde_json::Value;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// The arrays a primitive's triangles are read from: the corners' indices, and per vertex the
/// positions, and the normals, the two texture sets and the colours it declares.
struct Arrays<'a> {
    positions: &'a [f32],
    indices: &'a [u32],
    normals: Option<&'a [f32]>,
    sets: [Option<&'a [f32]>; 2],
    colours: Option<&'a [f32]>,
}

impl<'a> Arrays<'a> {
    /// The arrays of a baked mesh, its attributes picked by their kinds.
    fn of_baked(baked: &'a Baked) -> Self {
        let named = move |flag: u32| {
            (baked.attributes.iter())
                .find(|attribute| attribute.flag == flag)
                .map(|attribute| &attribute.values[..])
        };
        Self {
            positions: &baked.positions,
            indices: &baked.indices,
            normals: named(FLAG_NORMAL),
            sets: [named(FLAG_UV), named(FLAG_UV1)],
            colours: named(FLAG_COLOR),
        }
    }
}

impl Traceable {
    /// Reads mesh `mesh` of `g` from `bin`: every triangle primitive, as declared.
    pub fn read(g: &Value, bin: &[u8], mesh: usize, previews: &[TexturePreview]) -> Result<Self> {
        Self::read_with(g, bin, mesh, previews, &[])
    }

    /// `read`, the primitives of `baked` — each by its index in the mesh — read from the mesh their
    /// displacement was baked into, whose triangles are the ones its build holds.
    pub fn read_with(
        g: &Value,
        bin: &[u8],
        mesh: usize,
        previews: &[TexturePreview],
        baked: &[(usize, &Baked)],
    ) -> Result<Self> {
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
            let id = primitive.get("material").and_then(Value::as_u64);
            let material = materials
                .iter()
                .position(|&of| of == id)
                .unwrap_or_else(|| {
                    surfaces.push(Surface::of(g, id, previews));
                    materials.push(id);
                    materials.len() - 1
                }) as u32;
            let own;
            let arrays = match baked.iter().find(|(at, _)| *at == index) {
                Some((_, baked)) => Arrays::of_baked(baked),
                None => {
                    let (positions, indices, _) = read(g, bin, primitive, None)?;
                    own = (
                        positions.collect_f32()?,
                        indices,
                        attribute("NORMAL")?,
                        [attribute("TEXCOORD_0")?, attribute("TEXCOORD_1")?],
                        attribute("COLOR_0")?,
                    );
                    Arrays {
                        positions: &own.0,
                        indices: &own.1,
                        normals: own.2.as_deref(),
                        sets: [own.3[0].as_deref(), own.3[1].as_deref()],
                        colours: own.4.as_deref(),
                    }
                }
            };
            push_triangles(&arrays, material, (&mut triangles, &mut tags, &mut corners));
            ranges.push((index, first..tags.len()));
        }
        let mut read = Self::new(triangles, tags, corners, surfaces);
        read.primitives = ranges;
        Ok(read)
    }
}

/// The triangles of `arrays`, of material `material`, pushed onto the tracer's lists.
fn push_triangles(
    arrays: &Arrays<'_>,
    material: u32,
    (triangles, tags, corners): (&mut Vec<f32>, &mut Vec<u32>, &mut Vec<Corners>),
) {
    let Arrays {
        positions,
        indices,
        normals,
        sets,
        colours,
    } = arrays;
    // A colour is three or four wide, as its accessor declares.
    let width = colours.map_or(4, |c| c.len() / (positions.len() / 3).max(1));
    for triangle in indices.as_chunks::<3>().0 {
        let mut corner = Corners::default();
        let mut normal = [0.0f32; 9];
        let mut colour = [1.0f32; 12];
        for (k, &index) in triangle.iter().enumerate() {
            let i = index as usize;
            triangles.extend_from_slice(&positions[i * 3..i * 3 + 3]);
            for (set, uv) in sets.iter().enumerate() {
                let read = uv.and_then(|uv| uv.get(i * 2..i * 2 + 2));
                corner.uv[set][k * 2..k * 2 + 2].copy_from_slice(read.unwrap_or(&[0.0; 2]));
            }
            if let Some(n) = normals.and_then(|n| n.get(i * 3..i * 3 + 3)) {
                normal[k * 3..k * 3 + 3].copy_from_slice(n);
            }
            let read = colours.filter(|_| matches!(width, 3 | 4));
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
