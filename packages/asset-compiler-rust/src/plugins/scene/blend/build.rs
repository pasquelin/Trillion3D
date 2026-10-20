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
use crate::import::{primitive, Corner, Vertices};
use crate::plugins::scene::cancel;
use crate::plugins::scene::corners::{gltf_uv, Corners};
use trillion3d_math::vec3::point_checked;

/// A primitive under construction: the one corner builder, keyed by the vertex and the bits of
/// the corner's normal and texture coordinate.
type Primitive = Corners<[u32; 6]>;

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
    for face in 0..geometry.faces() {
        let first = geometry.offsets[face] as usize;
        let group = groups
            .entry(geometry.material[face])
            .or_insert_with(|| Corners::new(Vertices::default()));
        group.begin();
        for (rank, vertex) in geometry.face(face).iter().enumerate() {
            let (key, corner) = corner(geometry, normals, first + rank);
            let point = point_checked(&geometry.positions, *vertex).unwrap_or([0.0; 3]);
            group.corner(key, point, |out| corner.write(out));
        }
        let uncut = group.uncut;
        group.cut(cancelled, false).ok_or_else(cancel::refusal)?;
        if group.uncut != uncut {
            out.scene.count(crate::plugins::scene::codes::NGON_UNCUT, 1);
        }
    }
    let mut primitives = Vec::new();
    let mut triangles = 0;
    for (slot, group) in groups {
        let group = group.vertices;
        if group.indices.is_empty() {
            continue;
        }
        triangles += group.indices.len() / 3;
        let material = slots.get(slot as usize).copied().flatten();
        primitives.push(primitive(
            &group,
            &mut out.scene.bin,
            &mut out.scene.accessors,
            material,
        ));
    }
    Ok((json!({"name": name, "primitives": primitives}), triangles))
}

/// What identifies a corner — its vertex and the bits of its normal and texture coordinate —
/// and the vertex it carries.
fn corner(geometry: &Geometry, normals: &[f32], corner: usize) -> ([u32; 6], Corner) {
    let vertex = geometry.corners[corner];
    let normal = slice3(normals, corner);
    let uv = (!geometry.uv.is_empty())
        .then(|| gltf_uv([geometry.uv[corner * 2], geometry.uv[corner * 2 + 1]]));
    let [u, v] = uv.unwrap_or([0.0, 0.0]);
    let [x, y, z] = normal;
    let key = [
        vertex,
        x.to_bits(),
        y.to_bits(),
        z.to_bits(),
        u.to_bits(),
        v.to_bits(),
    ];
    let position = slice3(&geometry.positions, vertex as usize);
    (
        key,
        Corner {
            position,
            normal,
            uv,
        },
    )
}

/// The three floats of a rank, or three zeros when the array does not carry them.
fn slice3(values: &[f32], rank: usize) -> [f32; 3] {
    values
        .get(rank * 3..rank * 3 + 3)
        .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
}
