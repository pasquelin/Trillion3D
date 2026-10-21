//! The cap closing the scene's base, an option off by default: one more mesh under the scene, read
//! by the field like any other, so that an open scan without a bottom still closes — a flat convex
//! polygon, or a convex slab under it (`slab`). It is built in the reference's frame, centimetres
//! and `z` up — our point `(x, y, z)` is its `100 · (x, z, y)`, a mirror under which every
//! triangle keeps its corners' order (`to_reference`) —, and returned in ours:
//!
//! 1. the range of heights `[low, low + height]`, `low` the scene's least height, both ends held;
//! 2. each placed mesh's vertices within that range, in its vertex order, as points `(x, y)` of the
//!    ground plane, and their convex hull (`planar::hull`); a mesh without a hull — fewer than
//!    three distinct points, or all on one line — gives no corner. The meshes' hull corners are
//!    gathered mesh after mesh, in hull order, each mesh's hull found on its own thread;
//! 3. the convex hull of every corner gathered: the cap's polygon, in hull order; none, no cap. A
//!    hull has three corners at least, so the cap is never refused for having fewer than two;
//! 4. the polygon triangulated by its ears (`planar::polygon`): the mesh's vertices its corners in
//!    hull order, each at `(x, y, 0) + low · (0, 0, 1)`; its triangles its ears in the order cut,
//!    each `[prev, ear, next]` — ids in that order, none refused (the ears are one disk), none
//!    freed;
//! 5. with no thickness, each triangle's first two corners exchanged, `[a, b, c]` to `[b, a, c]`.
//!    The hull winds counterclockwise seen from above, and so does each ear: down by the
//!    reference's normal `(c − a) × (b − a)`. The exchange turns the cap up, though the reference
//!    means it to face down — its quirk, kept. With a thickness, the slab (`slab`).
//!
//! The reference gathers the meshes' corners (step 2) in whatever order its threads finish; the
//! cap is the same in any order: the hull (step 3) first sorts its points by value, so the sorted
//! values are the same whatever order they came in, keeps one point of each run of equal ones —
//! the same value —, and from there reads values only. The polygon — its corners, the first of
//! them and its turn — is the same, but for the sign of a zero coordinate among equal points.
use crate::hlod::flatten::planar::hull::convex_hull;
use crate::hlod::flatten::planar::polygon::triangulate_simple;
use crate::hlod::flatten::units::{from_reference, to_reference, CENTIMETRES};
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{add, scale};
mod slab;

/// The ground-plane corners of the hull of the vertices of `placed` whose reference height lies
/// within `[low, high]`, both ends held (step 2), in hull order; none when they have no hull.
fn hull_corners(placed: &[[f64; 3]], (low, high): (f64, f64)) -> Vec<[f64; 2]> {
    let ground: Vec<[f64; 2]> = (placed.iter().map(|&p| to_reference(p)))
        .filter(|p| p[2] >= low && p[2] <= high)
        .map(|p| [p[0], p[1]])
        .collect();
    convex_hull(&ground).map_or_else(Vec::new, |hull| hull.iter().map(|&k| ground[k]).collect())
}

/// The cap closing the base of the scene whose meshes' vertices, placed, are `instances` — in our
/// frame, metres, each mesh's in its vertex order, the meshes in the scene's order —, under the
/// least height `bottom` across the range `height` above it, metres (module doc): the flat polygon
/// when `thickness` is zero, else the slab `thickness` deep below it (not negative). Its vertices,
/// in our frame, and its triangles, both in the order the reference's mesh holds them; none when
/// the reference appends no cap — no hull in the range.
pub(super) fn base_mesh(
    instances: &[Vec<[f64; 3]>],
    bottom: f64,
    height: f64,
    thickness: f64,
) -> Option<(Vec<[f64; 3]>, Vec<[usize; 3]>)> {
    let low = bottom * CENTIMETRES;
    let range = (low, low + height * CENTIMETRES);
    let corners: Vec<[f64; 2]> = (instances.par_iter())
        .flat_map_iter(|placed| hull_corners(placed, range))
        .collect();
    let hull = convex_hull(&corners)?;
    let polygon: Vec<[f64; 2]> = hull.iter().map(|&k| corners[k]).collect();
    let ears = triangulate_simple(&polygon);
    let lift = scale([0.0, 0.0, 1.0], low);
    let points: Vec<[f64; 3]> = (polygon.iter())
        .map(|&[x, y]| add([x, y, 0.0], lift))
        .collect();
    let (points, triangles) = if thickness == 0.0 {
        // The reference's quirk, kept: its cap meant to face down is turned up (step 5).
        let turned = ears.into_iter().map(|[a, b, c]| [b, a, c]).collect();
        (points, turned)
    } else {
        slab::slab(points, ears, thickness * CENTIMETRES)
    };
    Some((points.into_iter().map(from_reference).collect(), triangles))
}
