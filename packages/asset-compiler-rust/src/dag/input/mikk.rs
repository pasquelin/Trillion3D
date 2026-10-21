//! The tangent space of every corner of a triangle mesh as Morten S. Mikkelsen's MikkTSpace
//! generator makes it (zlib licence, `THIRD_PARTY_NOTICES.md`), ported step by step for meshes of
//! triangles — an altered version of that software, not the original —: the build takes it in
//! place of the tangent its groups of triangles average when its rules name it (`frames.rs`).
//! Every step reads a corner as its position, its normal and its first texture coordinate pair, as
//! the generator's caller hands them; every float is computed in single precision in the
//! generator's order, an angle's arc cosine in double. The generator's step that lays a degenerate
//! triangle's spaces runs, as a build that keeps its degenerate triangles runs it.
//!
//! 1. **Weld** (`weld.rs`): corners equal in position, normal and texture coordinates on every
//!    axis are one vertex, named by the first of them; every later step reads a corner through
//!    its vertex.
//! 2. **Faces** (`faces.rs`): a triangle two of whose corners lie at one point is degenerate and
//!    set aside, the others kept in order. Each kept one takes the derivatives of its position
//!    along its texture's u and v, made unit and signed by whether its texture mapping keeps its
//!    orientation; it is good when its texture area and both derivatives are more than nothing,
//!    else it groups with any. Its neighbour across each edge is the first triangle, in edge
//!    order, running that edge the other way whose own side is free.
//! 3. **Groups** (`groups.rs`): around each vertex, good triangles of one orientation reached from
//!    one another across the edges from it make a group, grown depth first from the first
//!    triangle, in order, whose corner at that vertex has none; a triangle grouping with any takes
//!    the orientation of the first group that reaches it.
//! 4. **Spaces** (`spaces.rs`): each corner of a group takes the angle-weighted mean of the
//!    derivatives of the triangles of its group whose derivatives turn by less than half a turn
//!    from its own, each projected across the vertex's normal; a degenerate triangle's corner
//!    takes the space of the first kept corner of its vertex; a corner no group reached keeps
//!    +X, its orientation not kept.
mod faces;
mod groups;
mod spaces;
mod weld;

use trillion3d_math::vector::vecn::{dot, length, scale, sub};

type V3 = [f32; 3];

/// One corner as the generator reads it.
#[derive(Clone, Copy, Debug)]
pub(super) struct Corner {
    pub position: V3,
    pub normal: V3,
    pub uv: [f32; 2],
}

/// A corner's tangent space as the generator lays it: its tangent, unit, and whether the texture
/// mapping of its group keeps its orientation.
pub(super) type Space = (V3, bool);

/// The tangent space of each of `corners`, three per triangle in order (the module's rule).
pub(super) fn spaces(corners: &[Corner]) -> Vec<Space> {
    let welded = weld::welded(corners);
    let read = |c: u32| &corners[welded[c as usize] as usize];
    // The triangles as their corners' vertices, the degenerate ones set aside.
    let (mut kept, mut degenerate) = (Vec::new(), Vec::new());
    for t in 0..(corners.len() / 3) as u32 {
        let [a, b, c] = [0, 1, 2].map(|k| read(t * 3 + k).position);
        match a == b || a == c || b == c {
            true => degenerate.push(t),
            false => kept.push(t),
        }
    }
    let vertices: Vec<[u32; 3]> = (kept.iter())
        .map(|&t| [0, 1, 2].map(|k| welded[(t * 3 + k) as usize]))
        .collect();
    let mut faces = faces::faces(corners, &vertices);
    let (groups, assigned) = groups::groups(&mut faces, &vertices);
    let laid = spaces::Laid {
        corners,
        kept: &kept,
        vertices: &vertices,
        faces: &faces,
    };
    let mut out = laid.spaces(&groups, &assigned);
    spaces::degenerate(&mut out, &welded, &laid, &degenerate);
    out
}

/// What the generator reads as more than nothing: a magnitude past the least normal float.
fn not_zero(x: f32) -> bool {
    x.abs() > f32::MIN_POSITIVE
}

/// Whether some axis of `v` is more than nothing.
fn v_not_zero(v: V3) -> bool {
    not_zero(v[0]) || not_zero(v[1]) || not_zero(v[2])
}

/// `v` over its length, as the generator divides: by the reciprocal.
fn normalize(v: V3) -> V3 {
    scale(v, 1.0 / length(v))
}

/// `v` less its part along `n`, made unit when that is more than nothing.
fn across(v: V3, n: V3) -> V3 {
    let flat = sub(v, scale(n, dot(n, v)));
    if v_not_zero(flat) {
        normalize(flat)
    } else {
        flat
    }
}
