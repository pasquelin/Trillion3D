//! From read geometry to glTF primitives: one primitive per material, n-gons ear-clipped.
//!
//! Blender stores the material index on the face; glTF stores it on the primitive. Faces are
//! therefore grouped by material slot, in increasing slot order, and each group becomes a
//! primitive with its own accessors. Two corners that carry exactly the same vertex, the same
//! normal and the same texture coordinate are written only once; nothing is rounded or merged
//! beyond that exact equality.
//!
//! A single conversion touches texture coordinates: Blender places their origin at the bottom
//! left, glTF at the top left, so `v` becomes `1 - v`. That is the convention of the ma, alembic
//! and usd drivers, and it leaves the image bytes intact.
use super::*;
use crate::plugins::scene::{cancel, ngon::Ngon};

/// A face that ear-clipping could not fully cut: a self-intersecting polygon, or one with no
/// plane — all corners aligned, zero area. It comes out fanned from its first corner, which can
/// fill it beyond its silhouette, and that is what this count says.
const NGON_UNCUT: &str = "blend-ngon-untriangulable";

/// The arrays of a primitive under construction.
#[derive(Default)]
struct Primitive {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uv: Vec<f32>,
    indices: Vec<u32>,
    seen: HashMap<[u32; 6], u32>,
}

/// Builds the glTF mesh of a geometry and yields its JSON and its triangle count. `slots` gives
/// the material of each mesh slot, when it has one. The cancellation token is reread by face
/// slice: a single huge mesh stops too.
pub(super) fn mesh_json(
    geometry: &Geometry,
    normals: &[f32],
    slots: &[Option<usize>],
    name: &str,
    out: &mut Out,
    cancelled: &AtomicBool,
) -> Result<(Value, usize)> {
    let mut groups: BTreeMap<u32, Primitive> = BTreeMap::new();
    let mut cutter = Ngon::default();
    for face in 0..geometry.faces() {
        let first = geometry.offsets[face] as usize;
        cutter.begin();
        for vertex in geometry.face(face) {
            cutter.corner(slice3(&geometry.positions, *vertex as usize).map(f64::from));
        }
        let Some(exact) = cutter.cut(cancelled) else {
            return Err(cancel::refusal());
        };
        if !exact {
            out.count(NGON_UNCUT, 1);
        }
        let group = groups.entry(geometry.material[face]).or_default();
        for triangle in cutter.triangles() {
            for rank in triangle {
                let vertex = group.vertex(geometry, normals, first + rank);
                group.indices.push(vertex);
            }
        }
    }
    let mut primitives = Vec::new();
    let mut triangles = 0;
    for (slot, group) in groups {
        if group.indices.is_empty() {
            continue;
        }
        triangles += group.indices.len() / 3;
        let mut attributes = json!({
            "POSITION": out.floats(&group.positions, 3, true),
            "NORMAL": out.floats(&group.normals, 3, false),
        });
        if !group.uv.is_empty() {
            attributes["TEXCOORD_0"] = json!(out.floats(&group.uv, 2, false));
        }
        let mut primitive = json!({
            "attributes": attributes, "indices": out.indices(&group.indices), "mode": 4,
        });
        if let Some(Some(material)) = slots.get(slot as usize) {
            primitive["material"] = json!(material);
        }
        primitives.push(primitive);
    }
    Ok((json!({"name": name, "primitives": primitives}), triangles))
}

impl Primitive {
    /// The rank of this corner's vertex in this primitive, poured on first encounter.
    fn vertex(&mut self, geometry: &Geometry, normals: &[f32], corner: usize) -> u32 {
        let vertex = geometry.corners[corner];
        let normal = slice3(normals, corner);
        let uv = if geometry.uv.is_empty() {
            [0.0, 0.0]
        } else {
            // Blender places the UV origin at the bottom left, glTF at the top left: only the V
            // coordinate changes direction, and the image bytes are never retouched.
            [geometry.uv[corner * 2], 1.0 - geometry.uv[corner * 2 + 1]]
        };
        let key = [
            vertex,
            normal[0].to_bits(),
            normal[1].to_bits(),
            normal[2].to_bits(),
            uv[0].to_bits(),
            uv[1].to_bits(),
        ];
        if let Some(known) = self.seen.get(&key) {
            return *known;
        }
        let rank = (self.positions.len() / 3) as u32;
        self.positions
            .extend_from_slice(&slice3(&geometry.positions, vertex as usize));
        self.normals.extend_from_slice(&normal);
        if !geometry.uv.is_empty() {
            self.uv.extend_from_slice(&uv);
        }
        self.seen.insert(key, rank);
        rank
    }
}

/// The three floats of a rank, or three zeros when the array does not carry them.
fn slice3(values: &[f32], rank: usize) -> [f32; 3] {
    values
        .get(rank * 3..rank * 3 + 3)
        .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
}
