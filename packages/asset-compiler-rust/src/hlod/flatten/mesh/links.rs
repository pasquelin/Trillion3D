//! The links an edit rewires, one at a time, each the first match in its element's own order:
//! a triangle of an edge (`replace_face`), an end of an edge (`replace_end`), an edge of a
//! triangle (`replace_side`), a corner of a triangle (`replace_corner`); and what an edit reads off
//! a triangle: the edge on a pair of its corners (`side_on`), the triangle across an edge from it
//! (`other_face`), and a side's corners as it winds them with the corner across (`wound`).
use super::{Mesh, NONE};

/// Triangle `tri`'s corners from the side on `a` and `b`, whichever way round: that side's
/// corners as the triangle winds them, then the third. The first side, as the corners come, when
/// none is on them.
pub(super) fn wound(a: usize, b: usize, tri: [usize; 3]) -> [usize; 3] {
    let k = (0..3)
        .find(|&k| same_pair([a, b], [tri[k], tri[(k + 1) % 3]]))
        .unwrap_or(0);
    [tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]]
}

/// Whether two pairs hold the same two vertices, in either order.
fn same_pair([a0, a1]: [usize; 2], [b0, b1]: [usize; 2]) -> bool {
    if a0 == b0 {
        a1 == b1
    } else {
        a0 == b1 && a1 == b0
    }
}

impl Mesh {
    /// Edge `e`'s triangle `old` replaced by `new`: the first one moved into its place when `new`
    /// is `NONE`, so a held edge's first triangle always stands.
    pub(super) fn replace_face(&mut self, e: usize, old: usize, new: usize) {
        let faces = &mut self.edges[e].faces;
        if faces[0] == old {
            *faces = if new == NONE {
                [faces[1], NONE]
            } else {
                [new, faces[1]]
            };
        } else if faces[1] == old {
            faces[1] = new;
        }
    }

    /// Edge `e`'s end `old` replaced by `new`, its ends sorted again.
    pub(super) fn replace_end(&mut self, e: usize, old: usize, new: usize) {
        let [a, b] = self.edges[e].ends;
        let kept = if a == old {
            b
        } else if b == old {
            a
        } else {
            return;
        };
        self.edges[e].ends = [kept.min(new), kept.max(new)];
    }

    /// Triangle `t`'s first edge `old` replaced by `new`.
    pub(super) fn replace_side(&mut self, t: usize, old: usize, new: usize) {
        if let Some(side) = self.sides[t].iter_mut().find(|side| **side == old) {
            *side = new;
        }
    }

    /// Triangle `t`'s first corner `old` replaced by `new`.
    pub(super) fn replace_corner(&mut self, t: usize, old: usize, new: usize) {
        if let Some(corner) = self.triangles[t].iter_mut().find(|corner| **corner == old) {
            *corner = new;
        }
    }

    /// Triangle `t`'s edge on corners `a` and `b`, its sides tried in their order; `NONE` when no
    /// side is on them.
    pub(super) fn side_on(&self, t: usize, a: usize, b: usize) -> usize {
        let tri = self.triangles[t];
        (0..3)
            .find(|&k| same_pair([a, b], [tri[k], tri[(k + 1) % 3]]))
            .map_or(NONE, |k| self.sides[t][k])
    }

    /// The triangle across edge `e` from triangle `t`: `NONE` on the boundary or when `t` does not
    /// hold `e`.
    pub(super) fn other_face(&self, e: usize, t: usize) -> usize {
        match self.edges[e].faces {
            [a, b] if a == t => b,
            [a, b] if b == t => a,
            _ => NONE,
        }
    }
}
