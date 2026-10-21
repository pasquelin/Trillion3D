//! Step 4 of the tangent spaces (`mikk.rs`): every corner's space.
//!
//! Every corner starts at +X, its orientation not kept. The groups are read in order, each
//! triangle of a group in the order it joined. Across the normal of the group's vertex, each
//! triangle's derivatives are projected and made unit when more than nothing. A triangle's
//! members are the triangles of its group, itself among them, whose projected derivatives along u
//! and along v both have a cosine with its own above that of half a turn — every one when either
//! groups with any —, sorted. Each distinct set of members, once, takes as its space the sum of
//! its good members' projected derivatives along u, each weighed by the angle its triangle makes
//! at the vertex — between its two edges from it, each projected across the normal and made unit
//! when more than nothing, its cosine held within [-1, 1] —, made unit when more than nothing.
//! The triangle's corner at the vertex takes that space and the group's orientation.
//!
//! A degenerate triangle's corner then takes the space of the first corner of a kept triangle,
//! in order, at its vertex, when there is one.
use super::faces::{Face, GROUP_WITH_ANY, NONE};
use super::groups::Group;
use super::{across, normalize, v_not_zero, Corner, Space, V3};
use trillion3d_math::scalar::acos::acos;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// What the spaces read: the corners, the kept triangles — their rank among the source's and
/// their vertices — and their faces.
pub(super) struct Laid<'a> {
    pub corners: &'a [Corner],
    pub kept: &'a [u32],
    pub vertices: &'a [[u32; 3]],
    pub faces: &'a [Face],
}

/// The cosine two derivatives must exceed to share a space: that of half a turn, every pair but
/// one turned exactly back. The cosine of single precision's π, in double, is -1 less 4e-15,
/// which single precision holds as -1 on every host.
const HALF_TURN: f32 = -1.0;

impl Laid<'_> {
    /// Every corner's space but the degenerate triangles' (the module's rule), the groups
    /// `groups` and, per kept triangle and corner, the group it belongs to `assigned`.
    pub fn spaces(&self, groups: &[Group], assigned: &[[u32; 3]]) -> Vec<Space> {
        let threshold = HALF_TURN;
        let mut out: Vec<Space> = vec![([1.0, 0.0, 0.0], false); self.corners.len()];
        let mut projected: Vec<(V3, V3)> = Vec::new();
        let mut sets: Vec<(Vec<u32>, V3)> = Vec::new();
        for (g, group) in groups.iter().enumerate() {
            let normal = self.corners[group.vertex as usize].normal;
            projected.clear();
            projected.extend((group.faces.iter()).map(|&f| {
                let face = &self.faces[f as usize];
                (across(face.os, normal), across(face.ot, normal))
            }));
            sets.clear();
            for (at, &f) in group.faces.iter().enumerate() {
                let (os, ot) = projected[at];
                let any = |t: u32| self.faces[f as usize].flags | self.faces[t as usize].flags;
                let mut members: Vec<u32> = (group.faces.iter().zip(&projected))
                    .filter(|&(&t, &(os2, ot2))| {
                        let shared = dot(os, os2) > threshold && dot(ot, ot2) > threshold;
                        any(t) & GROUP_WITH_ANY != 0 || f == t || shared
                    })
                    .map(|(&t, _)| t)
                    .collect();
                members.sort_unstable();
                let space = match sets.iter().find(|(set, _)| *set == members) {
                    Some(&(_, space)) => space,
                    None => {
                        let space = self.mean(&members, group.vertex, normal);
                        sets.push((members, space));
                        space
                    }
                };
                let corner = (assigned[f as usize].iter()).position(|&a| a == g as u32);
                let corner = corner.expect("a group's triangle has a corner in it");
                out[(self.kept[f as usize] * 3) as usize + corner] = (space, group.orient);
            }
        }
        out
    }

    /// The angle-weighted mean derivative along u of the good triangles `members` at `vertex`,
    /// across `normal` (the module's rule).
    fn mean(&self, members: &[u32], vertex: u32, normal: V3) -> V3 {
        let mut sum = [0.0f32; 3];
        for &f in members {
            let face = &self.faces[f as usize];
            if face.flags & GROUP_WITH_ANY != 0 {
                continue;
            }
            let corners = self.vertices[f as usize];
            let Some(i) = corners.iter().position(|&v| v == vertex) else {
                continue;
            };
            let point = |k: usize| self.corners[corners[k] as usize].position;
            let (p0, p1, p2) = (point((i + 2) % 3), point(i), point((i + 1) % 3));
            let v1 = across(sub(p0, p1), normal);
            let v2 = across(sub(p2, p1), normal);
            let cosine = dot(v1, v2).clamp(-1.0, 1.0);
            let angle = acos(f64::from(cosine)) as f32;
            sum = add(sum, scale(across(face.os, normal), angle));
        }
        if v_not_zero(sum) {
            normalize(sum)
        } else {
            sum
        }
    }
}

/// Lays on every corner of the `degenerate` triangles the space of the first kept corner at its
/// vertex, `welded` naming each corner's (the module's rule).
pub(super) fn degenerate(out: &mut [Space], welded: &[u32], laid: &Laid, degenerate: &[u32]) {
    if degenerate.is_empty() {
        return;
    }
    let mut first = vec![NONE; welded.len()];
    for (f, corners) in laid.vertices.iter().enumerate() {
        for (k, &v) in corners.iter().enumerate() {
            if first[v as usize] == NONE {
                first[v as usize] = laid.kept[f] * 3 + k as u32;
            }
        }
    }
    for &t in degenerate {
        for c in t * 3..t * 3 + 3 {
            let source = first[welded[c as usize] as usize];
            if source != NONE {
                out[c as usize] = out[source as usize];
            }
        }
    }
}
