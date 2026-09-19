//! A Blender mesh to triangulated geometry.
//!
//! The mesh is described by corners: an offset array says where each face starts in the corner
//! sequence, and each corner points to a vertex. UVs live at the corner, the material index and
//! the "sharp face" mark live at the face. N-gons are ear-clipped in the plane of their normal,
//! which keeps exactly the vertices, area and orientation of a planar face, whether convex or
//! concave.
//!
//! No normal is stored in a Blender file: they are computed at read time, flat for a sharp face,
//! area-averaged for a smooth face, and cut on the edges `sharp_edge` marks — it is
//! `.corner_edge` that says which edge leaves each corner.
use super::*;

/// Mesh-read ceilings, so a damaged file never asks for an allocation it does not have the bytes to fill.
const MAX_VERTICES: usize = 64 * 1024 * 1024;
const MAX_CORNERS: usize = 256 * 1024 * 1024;

/// The geometry of a mesh, as the file carries it.
pub(super) struct Geometry {
    pub(super) positions: Vec<f32>,
    /// The vertex of each corner.
    pub(super) corners: Vec<u32>,
    /// The first corner of each face, plus the end of the last: `faces + 1` values.
    pub(super) offsets: Vec<u32>,
    /// Two floats per corner, empty when the mesh holds no UV layer.
    pub(super) uv: Vec<f32>,
    pub(super) material: Vec<u32>,
    pub(super) sharp: Vec<bool>,
    /// The edge that leads from this corner to the next of its face is hard; empty when none is.
    pub(super) sharp_corners: Vec<bool>,
}

impl Geometry {
    pub(super) fn faces(&self) -> usize {
        self.offsets.len().saturating_sub(1)
    }
    /// The corners of a face, in file order.
    pub(super) fn face(&self, rank: usize) -> &[u32] {
        let from = self.offsets[rank] as usize;
        let to = self.offsets[rank + 1] as usize;
        &self.corners[from..to]
    }
    /// The surface the shared normal computation reads.
    pub(super) fn surface(&self) -> normals::Surface<'_> {
        normals::Surface {
            positions: &self.positions,
            corners: &self.corners,
            offsets: &self.offsets,
            sharp_faces: &self.sharp,
            sharp_corners: &self.sharp_corners,
        }
    }
}

fn unsupported(mesh: &str, what: &str) -> CompilerError {
    refused(
        "blend-mesh-layout-unsupported",
        format!("blend: mesh {mesh} carries no {what}; this reader reads the named-attribute layout of Blender 4.4 and later"),
    )
}

/// Reads the geometry of a mesh. A mesh that does not carry the named-attribute layout is
/// refused by name rather than guessed.
pub(super) fn read(mesh: &At<'_>, name: &str) -> Result<Geometry> {
    let vertices = mesh.int("totvert", 0).max(0) as usize;
    let corner_count = mesh.int("totloop", 0).max(0) as usize;
    let faces = mesh.int("totpoly", 0).max(0) as usize;
    let edges = mesh.int("totedge", 0).max(0) as usize;
    if vertices > MAX_VERTICES || corner_count > MAX_CORNERS || edges > MAX_CORNERS {
        return Err(refused(
            "blend-too-large",
            format!("blend: mesh {name} announces more vertices or corners than this reader reads"),
        ));
    }
    let table = attrs::attributes(mesh);
    let positions = named(&table, "position", attrs::POINT, attrs::FLOAT3)
        .map(|attr| attr.floats(vertices, 3))
        .filter(|values| values.len() == vertices * 3)
        .ok_or_else(|| unsupported(name, "position attribute"))?;
    let corners = named(&table, ".corner_vert", attrs::CORNER, attrs::INT32)
        .map(|attr| attr.ints(corner_count))
        .filter(|values| values.len() == corner_count)
        .ok_or_else(|| unsupported(name, ".corner_vert attribute"))?;
    let offsets = offsets(mesh, faces, corner_count)
        .ok_or_else(|| unsupported(name, "readable face offsets"))?;
    if corners
        .iter()
        .any(|vertex| *vertex < 0 || *vertex as usize >= vertices)
    {
        return Err(refused(
            "blend-mesh-invalid",
            format!("blend: mesh {name} has a corner pointing outside its vertices"),
        ));
    }
    let material = named(&table, "material_index", attrs::FACE, attrs::INT32)
        .map(|attr| attr.ints(faces))
        .filter(|values| values.len() == faces)
        .map(|values| values.iter().map(|slot| (*slot).max(0) as u32).collect())
        .unwrap_or_else(|| vec![0; faces]);
    let sharp = named(&table, "sharp_face", attrs::FACE, attrs::BOOLEAN)
        .map(|attr| attr.bools(faces))
        .filter(|values| values.len() == faces)
        .unwrap_or_else(|| vec![false; faces]);
    let sharp_corners = hard(&table, &corners, edges);
    Ok(Geometry {
        positions,
        corners: corners.iter().map(|vertex| *vertex as u32).collect(),
        offsets,
        uv: uv(&table, corner_count),
        material,
        sharp,
        sharp_corners,
    })
}

/// The hard edge of each corner. Blender marks hardness on the edge, and `.corner_edge` says
/// which edge leaves each corner: a mesh without `sharp_edge` yields an empty array, which marks
/// nothing, rather than an array of falses as long as its corners.
fn hard(table: &[(String, attrs::Attr<'_>)], corners: &[i32], edges: usize) -> Vec<bool> {
    let Some(sharp) = named(table, "sharp_edge", attrs::EDGE, attrs::BOOLEAN)
        .map(|attr| attr.bools(edges))
        .filter(|values| values.iter().any(|edge| *edge))
    else {
        return Vec::new();
    };
    named(table, ".corner_edge", attrs::CORNER, attrs::INT32)
        .map(|attr| attr.ints(corners.len()))
        .filter(|values| values.len() == corners.len())
        .map(|values| {
            values
                .iter()
                .map(|edge| {
                    usize::try_from(*edge)
                        .ok()
                        .and_then(|edge| sharp.get(edge))
                        .copied()
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The attribute of the requested name, domain and type, when the mesh holds it.
fn named<'t, 'b>(
    table: &'t [(String, attrs::Attr<'b>)],
    wanted: &str,
    domain: i64,
    kind: i64,
) -> Option<&'t attrs::Attr<'b>> {
    table
        .iter()
        .find(|(name, attr)| name == wanted && attr.domain == domain && attr.kind == kind)
        .map(|(_, attr)| attr)
}

/// Face offsets: an array of `faces + 1` increasing integers, bounded by the corners.
fn offsets(mesh: &At<'_>, faces: usize, corners: usize) -> Option<Vec<u32>> {
    let bytes = ["poly_offset_indices", "face_offset_indices"]
        .into_iter()
        .find_map(|name| mesh.block(name))?;
    let values = bytes::ints(bytes, faces + 1);
    if values.len() != faces + 1 {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    let mut previous = 0u32;
    for value in values {
        let value = u32::try_from(value).ok()?;
        if value < previous || value as usize > corners {
            return None;
        }
        previous = value;
        out.push(value);
    }
    (out.last() == Some(&(corners as u32))).then_some(out)
}

/// The UV layer kept: the first two-component float layer held by the corners and named by the
/// author. Blender's internal layers start with a dot, and are not one.
fn uv(table: &[(String, attrs::Attr<'_>)], corners: usize) -> Vec<f32> {
    table
        .iter()
        .find(|(name, attr)| {
            attr.domain == attrs::CORNER && attr.kind == attrs::FLOAT2 && !name.starts_with('.')
        })
        .map(|(_, attr)| attr.floats(corners, 2))
        .filter(|values| values.len() == corners * 2)
        .unwrap_or_default()
}
