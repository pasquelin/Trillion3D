//! Tables of a `Mesh`, and the glTF primitive a material part draws from them.
//!
//! Polygons are triangulated by ears in the plane of their normal, which keeps the area and
//! silhouette of a concave face as of a convex one. Walk sense follows `orientation`:
//! `rightHanded`, USD's default, is already glTF's; `leftHanded` reverses each triangle rather
//! than flipping the normals. Texture coordinates go from USD's origin at bottom-left to
//! glTF's, at the top.
use super::*;
use crate::plugins::scene::convert::Vertices;
use crate::plugins::scene::corners::{gltf_uv, Corners};

/// Tables of a surface, read once for all its parts.
pub(super) struct Surface {
    points: Vec<[f32; 3]>,
    corners: Vec<i64>,
    /// Rank of the first corner of each face, and its corner count.
    faces: Vec<(usize, usize)>,
    normals: Option<primvar::Primvar<[f32; 3]>>,
    uvs: Option<primvar::Primvar<[f32; 2]>>,
    reversed: bool,
    /// Faces that `holeIndices` makes invisible: they are not emitted.
    holes: BTreeSet<usize>,
}

impl Surface {
    pub(super) fn read(
        world: &mut World<'_>,
        prim: &usd::Prim,
        points: Vec<[f32; 3]>,
        corners: Vec<i64>,
        faces: Vec<(usize, usize)>,
        holes: BTreeSet<usize>,
    ) -> Self {
        let (count, corner_count) = (points.len(), corners.len());
        let normals =
            primvar::read(prim, "normals", read::triples, count, corner_count).or_else(|| {
                primvar::read(prim, "primvars:normals", read::triples, count, corner_count)
            });
        let uvs = primvar::read(prim, "primvars:st", read::pairs, count, corner_count);
        let sampled =
            normals.as_ref().is_some_and(|(_, s)| *s) || uvs.as_ref().is_some_and(|(_, s)| *s);
        if sampled {
            world.scene.report.add(world::TIME_SAMPLE);
        }
        Self {
            points,
            corners,
            faces,
            normals: normals.map(|(primvar, _)| primvar),
            uvs: uvs.map(|(primvar, _)| primvar),
            reversed: read::text_attribute(prim, "orientation").as_deref() == Some("leftHanded"),
            holes,
        }
    }

    /// A material part as a glTF primitive, with its triangle count.
    pub(super) fn part(
        &self,
        world: &mut World<'_>,
        part: &subset::Part,
    ) -> Option<(Value, usize)> {
        let mut out: Corners<[u32; 3]> = Corners::new(Vertices::default());
        let cancelled = world.cancelled;
        for face in &part.faces {
            // An invisible face enters neither the buffer nor the indices: its vertices are
            // not even created.
            if self.holes.contains(face) {
                continue;
            }
            let Some((start, count)) = self.faces.get(*face).copied() else {
                continue;
            };
            // Fewer than three corners, or a corner the tables do not carry: the face is not a
            // surface, it leaves the scene and its count says so.
            let keys: Option<Vec<_>> = (0..count)
                .map(|offset| self.key(start + offset, *face))
                .collect();
            let Some(keys) = keys.filter(|keys| keys.len() >= 3) else {
                world.scene.report.add(world::FACE_INVALID);
                continue;
            };
            let corners = keys
                .into_iter()
                .enumerate()
                .map(|(offset, (key, values))| (key, self.point(start + offset), values));
            // The cutter rereads the token per face slice: a single huge mesh stops too. What
            // is placed stays, and `convert` then refuses the whole scene.
            if out
                .face(corners, Values::write, cancelled, self.reversed)
                .is_none()
            {
                break;
            }
        }
        world.scene.part_primitive(out, part.material)
    }

    /// Position of a corner, as a double, as the polygon cut reads it. A corner outside the
    /// tables gives the origin: `corner` has already dropped the face whose tables contradict.
    fn point(&self, corner: usize) -> [f64; 3] {
        self.point_index(corner)
            .and_then(|rank| self.points.get(rank))
            .map_or([0.0; 3], |axes| axes.map(f64::from))
    }

    /// Rank of the point a corner names, when the tables carry this corner and its index is a
    /// rank: that is the only reading of `corners` of the cut.
    fn point_index(&self, corner: usize) -> Option<usize> {
        usize::try_from(*self.corners.get(corner)?).ok()
    }

    /// What identifies a face corner — its point, and the slots of its normal and texture
    /// coordinate — and the values its vertex carries. `None` when a table is too short: the
    /// corner, and its face, are dropped rather than leaving a half-vertex.
    fn key(&self, corner: usize, face: usize) -> Option<([u32; 3], Values)> {
        let point = self.point_index(corner)?;
        let slot = |values: Option<u32>| values.unwrap_or(0);
        let normal = match self.normals.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let uv = match self.uvs.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let key = [u32::try_from(point).ok()?, slot(normal), slot(uv)];
        let values = Values {
            position: *self.points.get(point)?,
            normal: match (&self.normals, normal) {
                (Some(values), Some(slot)) => Some(unit(values.get(slot)?)),
                _ => None,
            },
            uv: match (&self.uvs, uv) {
                (Some(values), Some(slot)) => Some(gltf_uv(values.get(slot)?)),
                _ => None,
            },
        };
        Some((key, values))
    }
}

/// What the vertex of a corner carries.
struct Values {
    position: [f32; 3],
    normal: Option<[f32; 3]>,
    uv: Option<[f32; 2]>,
}

impl Values {
    /// Pours the vertex into `vertices`.
    fn write(vertices: &mut Vertices, values: Self) {
        vertices.positions.extend(values.position);
        vertices.normals.extend(values.normal.into_iter().flatten());
        vertices.uvs.extend(values.uv.into_iter().flatten());
    }
}

/// A normal brought back to length one; a null normal becomes glTF's up axis.
fn unit([x, y, z]: [f32; 3]) -> [f32; 3] {
    let unit = trillion3d_math::vector::vec3::normalized_or(
        [f64::from(x), f64::from(y), f64::from(z)],
        [0.0, 1.0, 0.0],
    );
    unit.map(|part| part as f32)
}
