//! Step 2 of the tangent spaces (`mikk.rs`): every kept triangle's derivatives, its flags and its
//! neighbours.
//!
//! **Derivatives.** Over its corners `v1, v2, v3` and their texture coordinates `t1, t2, t3`, with
//! `d1 = v2 - v1` and `d2 = v3 - v1`, a triangle's texture area doubled and signed is
//! `t21.x t31.y - t21.y t31.x`; its mapping keeps its orientation when that is above zero. Its
//! derivative along u is `t31.y d1 - t21.y d2`, along v `t21.x d2 - t31.x d1`. When the area is
//! more than nothing (`not_zero`), each derivative more than nothing is made unit and turned
//! back when the mapping does not keep the orientation, and its magnitude is its length over the
//! area; the triangle is good when both magnitudes are more than nothing, else it groups with any.
//!
//! **Neighbours.** Every edge of every kept triangle is named by its two vertices, the lesser
//! first, and its triangle; in that order, each edge whose side of its triangle is free takes as
//! neighbour the first later triangle on the same two vertices that runs them the other way and
//! whose side is free, both sides then taken.
use super::{not_zero, Corner, V3};
use trillion3d_math::vector::vecn::{add, length, scale, sub};

/// A triangle whose texture mapping keeps its orientation.
pub(super) const ORIENT_PRESERVING: u8 = 8;
/// A triangle whose derivatives are nothing, which joins whatever group reaches it.
pub(super) const GROUP_WITH_ANY: u8 = 4;
/// No triangle across an edge.
pub(super) const NONE: u32 = u32::MAX;

/// A kept triangle as the groups and spaces read it.
#[derive(Clone, Copy, Debug)]
pub(super) struct Face {
    /// Its derivatives along u and v, unit and signed (the module's rule).
    pub os: V3,
    pub ot: V3,
    pub flags: u8,
    /// Per edge `k` — from corner `k` to the next —, the triangle across it, or `NONE`.
    pub neighbours: [u32; 3],
}

/// The kept triangles `vertices` over `corners`, each its derivatives, flags and neighbours (the
/// module's rule).
pub(super) fn faces(corners: &[Corner], vertices: &[[u32; 3]]) -> Vec<Face> {
    let mut faces: Vec<Face> = vertices.iter().map(|&t| face(corners, t)).collect();
    neighbours(&mut faces, vertices);
    faces
}

/// One kept triangle's derivatives and flags, its neighbours none yet.
fn face(corners: &[Corner], [a, b, c]: [u32; 3]) -> Face {
    let corner = |v: u32| &corners[v as usize];
    let (v1, v2, v3) = (corner(a).position, corner(b).position, corner(c).position);
    let (t1, t2, t3) = (corner(a).uv, corner(b).uv, corner(c).uv);
    let (t21x, t21y) = (t2[0] - t1[0], t2[1] - t1[1]);
    let (t31x, t31y) = (t3[0] - t1[0], t3[1] - t1[1]);
    let (d1, d2) = (sub(v2, v1), sub(v3, v1));
    let signed_area = t21x * t31y - t21y * t31x;
    let os = sub(scale(d1, t31y), scale(d2, t21y));
    let ot = add(scale(d1, -t31x), scale(d2, t21x));
    let mut flags = GROUP_WITH_ANY;
    if signed_area > 0.0 {
        flags |= ORIENT_PRESERVING;
    }
    let mut face = Face {
        os: [0.0; 3],
        ot: [0.0; 3],
        flags,
        neighbours: [NONE; 3],
    };
    if not_zero(signed_area) {
        let area = signed_area.abs();
        let (length_s, length_t) = (length(os), length(ot));
        let turn = if flags & ORIENT_PRESERVING == 0 {
            -1.0
        } else {
            1.0
        };
        if not_zero(length_s) {
            face.os = scale(os, turn / length_s);
        }
        if not_zero(length_t) {
            face.ot = scale(ot, turn / length_t);
        }
        if not_zero(length_s / area) && not_zero(length_t / area) {
            face.flags &= !GROUP_WITH_ANY;
        }
    }
    face
}

/// Edge `k` of triangle `t` running from `i0` to `i1`, as its corners name it: the edge holding
/// both, and its two vertices in the triangle's order.
fn edge([a, b, c]: [u32; 3], i0: u32, i1: u32) -> (u32, u32, usize) {
    let on = |v: u32| v == i0 || v == i1;
    match (on(a), on(b)) {
        (true, true) => (a, b, 0),
        (true, false) => (c, a, 2),
        _ => (b, c, 1),
    }
}

/// Pairs every edge with its neighbour (the module's rule).
fn neighbours(faces: &mut [Face], vertices: &[[u32; 3]]) {
    let mut edges: Vec<(u32, u32, u32)> = Vec::with_capacity(vertices.len() * 3);
    for (f, t) in vertices.iter().enumerate() {
        for k in 0..3 {
            let (i0, i1) = (t[k], t[(k + 1) % 3]);
            edges.push((i0.min(i1), i0.max(i1), f as u32));
        }
    }
    edges.sort_unstable();
    for (i, &(i0, i1, f)) in edges.iter().enumerate() {
        let (a0, a1, side_a) = edge(vertices[f as usize], i0, i1);
        if faces[f as usize].neighbours[side_a] != NONE {
            continue;
        }
        let same = edges[i + 1..].iter().take_while(|e| e.0 == i0 && e.1 == i1);
        let found = same
            .map(|&(_, _, t)| (t, edge(vertices[t as usize], i0, i1)))
            .find(|&(t, (b1, b0, side_b))| {
                a0 == b0 && a1 == b1 && faces[t as usize].neighbours[side_b] == NONE
            });
        if let Some((t, (_, _, side_b))) = found {
            faces[f as usize].neighbours[side_a] = t;
            faces[t as usize].neighbours[side_b] = f;
        }
    }
}
