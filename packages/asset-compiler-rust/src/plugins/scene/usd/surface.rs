//! Tables of a `Mesh`, and the glTF primitive a material part draws from them.
//!
//! Polygons are triangulated by ears in the plane of their normal, which keeps the area and
//! silhouette of a concave face as of a convex one. Walk sense follows `orientation`:
//! `rightHanded`, USD's default, is already glTF's; `leftHanded` reverses each triangle rather
//! than flipping the normals. Texture coordinates go from USD's origin at bottom-left to
//! glTF's, at the top.
use super::*;
use crate::import::Vertices;
use crate::plugins::scene::ngon::Ngon;

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
            world.refuse(world::TIME_SAMPLE);
        }
        Self {
            points,
            corners,
            faces,
            normals: normals.map(|(primvar, _)| primvar),
            uvs: uvs.map(|(primvar, _)| primvar),
            reversed: mesh::scheme(prim, "orientation").as_deref() == Some("leftHanded"),
            holes,
        }
    }

    /// A material part as a glTF primitive, with its triangle count.
    pub(super) fn part(
        &self,
        world: &mut World<'_>,
        part: &subset::Part,
    ) -> Option<(Value, usize)> {
        let mut out = Vertices::default();
        let mut unique: HashMap<[u32; 3], u32> = HashMap::new();
        // A single ring and a single cutter, emptied from one face to the next: the loop walks
        // each face of the part, and an allocation per face would only remake the same buffer.
        let mut corners: Vec<u32> = Vec::new();
        let mut cutter = Ngon::default();
        let cancelled = world.cancelled;
        for face in &part.faces {
            // An invisible face enters neither the buffer nor the indices: its vertices are
            // not even created, `corner` being called only for emitted faces.
            if self.holes.contains(face) {
                continue;
            }
            let Some((start, count)) = self.faces.get(*face).copied() else {
                continue;
            };
            corners.clear();
            corners
                .extend((0..count).filter_map(|offset| {
                    self.corner(&mut out, &mut unique, start + offset, *face)
                }));
            // Fewer than three corners, or a corner the tables do not carry: the face is not a
            // surface, it leaves the scene and its count says so.
            if corners.len() < 3 || corners.len() < count {
                world.refuse(world::FACE_INVALID);
                continue;
            }
            cutter.begin();
            for offset in 0..count {
                cutter.corner(self.point(start + offset));
            }
            // The cutter rereads the token per face slice: a single huge mesh stops too. What
            // is placed stays, and `convert` then refuses the whole scene.
            match cutter.cut(cancelled) {
                None => break,
                Some(false) => world.refuse(world::NGON_UNCUT),
                Some(true) => {}
            }
            for [a, b, c] in cutter.triangles() {
                match self.reversed {
                    true => out.indices.extend([corners[*a], corners[*c], corners[*b]]),
                    false => out.indices.extend([corners[*a], corners[*b], corners[*c]]),
                }
            }
        }
        world.scene.part_primitive(&out, part.material)
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

    /// glTF vertex of a face corner, created on first encounter. Nothing is written until the
    /// three vertex attributes are all read: a table too short drops the corner, it does not
    /// leave a half-vertex in the buffer.
    fn corner(
        &self,
        out: &mut Vertices,
        unique: &mut HashMap<[u32; 3], u32>,
        corner: usize,
        face: usize,
    ) -> Option<u32> {
        let point = self.point_index(corner)?;
        let normal = match self.normals.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let uv = match self.uvs.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let key = [
            u32::try_from(point).ok()?,
            normal.unwrap_or(0),
            uv.unwrap_or(0),
        ];
        if let Some(known) = unique.get(&key) {
            return Some(*known);
        }
        let position = *self.points.get(point)?;
        let normal = match (&self.normals, normal) {
            (Some(values), Some(slot)) => Some(unit(values.get(slot)?)),
            _ => None,
        };
        let uv = match (&self.uvs, uv) {
            (Some(values), Some(slot)) => {
                let [u, v] = values.get(slot)?;
                Some([u, 1.0 - v])
            }
            _ => None,
        };
        let id = u32::try_from(unique.len()).ok()?;
        out.positions.extend(position);
        if let Some(normal) = normal {
            out.normals.extend(normal);
        }
        if let Some(uv) = uv {
            out.uvs.extend(uv);
        }
        unique.insert(key, id);
        Some(id)
    }
}

/// A normal brought back to length one; a null normal becomes glTF's up axis.
fn unit([x, y, z]: [f32; 3]) -> [f32; 3] {
    let unit = crate::shared_math::normalized_or(
        [f64::from(x), f64::from(y), f64::from(z)],
        [0.0, 1.0, 0.0],
    );
    unit.map(|part| part as f32)
}
