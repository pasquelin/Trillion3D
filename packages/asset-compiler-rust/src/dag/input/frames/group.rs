//! The groups of triangles around a vertex a rebuild of the frames reads (`frames.rs`), and the
//! frame each gives the corners in it.
//!
//! **Fans** (`Fans`). Per vertex, the corners naming it, in the triangles' order.
//!
//! **Groups** (`Grouping::frames`). Two triangles of a vertex's fan are one group when they share
//! an edge from it — both name the same other vertex. Each group sums its triangles' normals, and
//! their tangents and binormals when it rebuilds the stored tangents, each times its corner's
//! weight when there are weights, those that are then something; each sum made unit when its
//! squared length exceeds `UNIT_SQUARED`. A corner takes the group's normal when its vertex's own
//! is nothing (1e-8 on every axis); its tangent — its own when something, else the group's — and
//! its bitangent — its tangent across its normal, unit, times its sign when both are something,
//! else the group's binormal — are made orthonormal around the normal (`group_frame`), and its
//! sign is the handedness of the three.
use super::face::{nothing, something, unit_or_nothing, SMALL, V3};
use super::Frame;
use crate::simplify::unit_or_same;
use trillion3d_math::join::{Join, LeastRoot};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// Per vertex, the corners naming it in order, each `(triangle, corner)`: vertex `v`'s from
/// `start[v]` to `start[v + 1]`.
pub(super) struct Fans {
    pub start: Vec<u32>,
    pub corners: Vec<(u32, u8)>,
}
impl Fans {
    /// The fans of `vertices` vertices under `triangles`.
    pub fn of(triangles: &[u32], vertices: usize) -> Self {
        let mut start = vec![0u32; vertices + 1];
        triangles.iter().for_each(|&v| start[v as usize + 1] += 1);
        (0..vertices).for_each(|v| start[v + 1] += start[v]);
        let mut next = start.clone();
        let mut corners = vec![(0, 0); triangles.len()];
        for (c, &v) in triangles.iter().enumerate() {
            corners[next[v as usize] as usize] = ((c / 3) as u32, (c % 3) as u8);
            next[v as usize] += 1;
        }
        Self { start, corners }
    }
    /// The corners naming vertex `v`.
    pub fn at(&self, v: usize) -> &[(u32, u8)] {
        &self.corners[self.start[v] as usize..self.start[v + 1] as usize]
    }
}

/// What the groups of a vertex read: the triangles, each one's frame (`face_frame`), each
/// corner's weight when the rules weigh them (`corner_weights`), none else, and whether the groups
/// rebuild the stored tangents.
pub(super) struct Grouping<'a> {
    pub triangles: &'a [u32],
    pub faces: &'a [[V3; 3]],
    pub weights: &'a [[f32; 3]],
    pub tangents: bool,
}
impl Grouping<'_> {
    /// Writes in `out` the frame each corner of `fan`, vertex `v`'s, takes from its group, `own`
    /// its vertex's frame (the module's rule).
    pub fn frames(&self, v: u32, fan: &[(u32, u8)], own: Frame, out: &mut [Frame]) {
        let mut groups = Join::<LeastRoot>::new(fan.len());
        let mut edges: Vec<(u32, u32)> = Vec::with_capacity(fan.len() * 2);
        for (slot, &(t, _)) in fan.iter().enumerate() {
            let corners = &self.triangles[t as usize * 3..t as usize * 3 + 3];
            edges.extend(
                corners
                    .iter()
                    .filter(|&&c| c != v)
                    .map(|&c| (c, slot as u32)),
            );
        }
        edges.sort_unstable();
        for pair in edges.windows(2).filter(|pair| pair[0].0 == pair[1].0) {
            groups.unite(pair[0].1, pair[1].1);
        }
        let parts = if self.tangents { 3 } else { 1 };
        for slots in groups.groups() {
            let mut sums = [[0.0f32; 3]; 3];
            for &slot in &slots {
                let (t, k) = fan[slot as usize];
                let weight = self.weights.get(t as usize).map_or(1.0, |w| w[k as usize]);
                for (sum, part) in sums.iter_mut().zip(self.faces[t as usize]).take(parts) {
                    let part = scale(part, weight);
                    if something(part, SMALL) {
                        *sum = add(*sum, part);
                    }
                }
            }
            let frame = group_frame(own, sums.map(unit_or_same), self.tangents);
            slots.iter().for_each(|&slot| out[slot as usize] = frame);
        }
    }
}

/// The frame a group with summed (normal, tangent, binormal) gives a corner of a vertex whose own
/// is `own`, its stored tangent rebuilt from the group when `tangents` (the module's rule).
fn group_frame(own: Frame, [normal, tangent, binormal]: [V3; 3], tangents: bool) -> Frame {
    let (n, stored) = own;
    let n = if nothing(n, SMALL) { normal } else { n };
    if !tangents {
        return (n, stored);
    }
    let (t, sign) = ([stored[0], stored[1], stored[2]], stored[3]);
    let mut along = if nothing(t, SMALL) { tangent } else { t };
    let mut across = binormal;
    if !nothing(n, SMALL) && !nothing(t, SMALL) {
        let own_across = scale(unit_or_nothing(cross(t, n), SMALL), sign);
        if !nothing(own_across, SMALL) {
            across = own_across;
        }
    }
    across = unit_or_same(sub(across, scale(along, dot(along, across))));
    along = unit_or_same(sub(along, scale(n, dot(n, along))));
    across = unit_or_same(sub(across, scale(n, dot(n, across))));
    // The handedness of tangent, bitangent and normal: their determinant, read the other way.
    let handed = -dot(along, cross(across, n));
    let sign = if handed < 0.0 { -1.0 } else { 1.0 };
    (n, [along[0], along[1], along[2], sign])
}
