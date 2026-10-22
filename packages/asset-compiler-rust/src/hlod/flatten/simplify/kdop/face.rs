//! A triangle as a leaf of the tree holds it (`Face`): its corners and its plane, and where a
//! segment meets it (`Face::crossed`, the module doc of `kdop.rs`).
use super::walk::Segment;
use trillion3d_math::scalar::{not_at_most, not_below};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, sub};

/// The product of a segment's ends' distances to a plane at or under which they lie on its two
/// sides: minus a ten-thousandth, single precision widened.
const SIDES: f64 = -0.0001f32 as f64;

/// How far past an edge, towards its outside, a point still lies within it: a ten-thousandth,
/// single precision widened.
const EDGE: f64 = 0.0001f32 as f64;

/// A leaf's triangle: its corners, its plane — the unit normal of `(b − c) × (a − c)`, none for a
/// triangle without area, and minus its offset `a · n` — and its rank among the triangles the tree
/// was built over.
pub(super) struct Face {
    pub corners: [[f64; 3]; 3],
    pub plane: [f64; 4],
    pub triangle: u32,
}

impl Face {
    /// The fraction of `segment` at which it meets the face, when it meets it before `limit`: its
    /// ends on the plane's two sides (`SIDES`), the fraction at or past zero and before `limit`,
    /// and the point there within each edge (`EDGE`) — each edge's outward normal in the plane,
    /// the normal crossed with the edge, read at the point against its value at the edge's start.
    pub(super) fn crossed(&self, segment: &Segment, limit: f64) -> Option<f64> {
        let [nx, ny, nz, w] = self.plane;
        let distance = |p: [f64; 3]| ((nx * p[0] + w) + ny * p[1]) + nz * p[2];
        let (from, to) = (distance(segment.start), distance(segment.end));
        if not_at_most(from * to, SIDES) {
            return None;
        }
        let time = from / (from - to);
        if !(time >= 0.0 && time < limit) {
            return None;
        }
        let point: [f64; 3] = std::array::from_fn(|k| segment.along[k] * time + segment.start[k]);
        for side in 0..3 {
            let (a, b) = (self.corners[side], self.corners[(side + 1) % 3]);
            let outward = cross([nx, ny, nz], sub(b, a));
            if not_below(dot(outward, point) - dot(outward, a), EDGE) {
                return None;
            }
        }
        Some(time)
    }
}

/// The first of `faces` the segment meets before the nearest hit so far, `time`, and at the least
/// fraction — the first of equal ones —, `time` narrowed to it; none when no face is met before it.
pub(super) fn met(faces: &[Face], segment: &Segment, time: &mut f32) -> Option<u32> {
    let limit = f64::from(*time);
    let mut best: Option<(u32, f64)> = None;
    for face in faces {
        let Some(at) = face.crossed(segment, limit) else {
            continue;
        };
        if best.is_none_or(|(_, least)| at < least) {
            best = Some((face.triangle, at));
        }
    }
    let (triangle, at) = best?;
    *time = at as f32;
    Some(triangle)
}
