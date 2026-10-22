//! The walls the reduction folded into each other pushed apart (`correct_walls`): a very thin wall
//! of the sources can come out of the reduction as two sheets crossing each other. A tree over the
//! simplified mesh's triangles (`kdop`) takes each face's three edges, start to end; a face whose
//! edge first meets another face — not itself, from the edge's first thousandth to its last, and
//! facing it within twenty degrees of opposite (their normals' cosine at most −0.94) — is pushed
//! along its own normal by a seventh of a voxel. The faces are found on the mesh
//! as the reduction left it, and pushed one after the other in ascending order, each along its
//! normal as the pushes before it left it — the one order that reproduces from run to run.
use super::convert::clockwise_normal;
use super::kdop::{Tree, Walk};
use super::proxy::Proxy;
use rayon::prelude::*;
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vecn::dot;

/// The fractions of an edge past which, and under which, a hit is the edge's own corner.
const LAST: f64 = 0.999;
const FIRST: f64 = 0.001;

/// The cosine at or under which two faces face each other.
const FACING: f32 = -0.94;

/// The voxel's share a face is pushed by: one over this.
const PUSH: f32 = 7.0;

/// Whether an edge of face `f` of `mesh` first meets another face facing it (module doc), `tree`
/// the tree over its faces, `walk` its scratch.
fn crossed(mesh: &Proxy, tree: &Tree, f: usize, walk: &mut Walk) -> bool {
    let corners = mesh.corners(f);
    let normal = clockwise_normal(corners);
    (0..3).any(|j| {
        let edge = (
            corners[j].map(f64::from),
            corners[(j + 1) % 3].map(f64::from),
        );
        let Some(hit) = tree.closest(edge, walk) else {
            return false;
        };
        let other = hit.triangle as usize;
        let time = f64::from(hit.time);
        other != f
            && !(time > LAST || time < FIRST)
            && not_above(dot(normal, clockwise_normal(mesh.corners(other))), FACING)
    })
}

/// `proxy`'s walls pushed apart (module doc), `voxel` the voxel's side, centimetres.
pub(super) fn correct_walls(proxy: &mut Proxy, voxel: f64) {
    let faces = proxy.indices.len() / 3;
    let pushed: Vec<bool> = {
        let mesh: &Proxy = proxy;
        let tree = Tree::over(faces, |f| mesh.corners(f));
        (0..faces)
            .into_par_iter()
            .map_init(Walk::default, |walk, f| crossed(mesh, &tree, f, walk))
            .collect()
    };
    let step = voxel as f32 / PUSH;
    for f in (0..faces).filter(|&f| pushed[f]) {
        let shift = clockwise_normal(proxy.corners(f)).map(|x| x * step);
        for k in 0..3 {
            let point = &mut proxy.points[proxy.indices[3 * f + k] as usize];
            (0..3).for_each(|a| point[a] += shift[a]);
        }
    }
}
