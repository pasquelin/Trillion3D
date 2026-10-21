//! The convex slab under the scene: the cap's polygon (`base.rs` step 4) offset into a solid along
//! its ears' normals, as the reference's offset of a selected region leaves it — each of its steps
//! that runs for this input, reduced to the arrays it gives. The polygon has `n` corners, vertices
//! `0..n` in hull order, and `n − 2` ears, triangles `0..n − 2` in the order cut; every ear is
//! selected:
//!
//! 1. the ears are one disk, so the selection is one region and a whole component, offset as a
//!    solid; its triangles in the order a depth-first flood from ear 0 meets them, the neighbours
//!    across each ear's sides `(a, b)`, `(b, c)`, `(c, a)` pushed in turn and the last pushed taken
//!    first (`topology::components`) — the region's order;
//! 2. no vertex of a disk joins two fans of triangles: none is split. The region's regrouping
//!    moves no vertex and changes no triangle;
//! 3. the region's boundary ring (`boundary_ring`): its first side on the boundary is met in the
//!    region's first triangle, ear 0, whose side `(a, b)` is a side of the polygon; walked the way
//!    its ear winds it, every ear winding the polygon's sides the polygon's way, the ring runs from
//!    `a = ears[0][0]` up the hull, `(a + k) mod n`;
//! 4. the ring's sides grouped: the first side a group of its own; from the last side back, each
//!    side parallel to the first (`parallel`) joins the first's group, until one is not; from the
//!    second side up to that one, a side parallel to the one before it joins that one's group,
//!    else starts a new group. When the first and the last sides share a group and two neighbours
//!    do not, the ring is turned to start after the first two that do not;
//! 5. the region duplicated in the region's order: each ear's corners in turn, a vertex met for
//!    the first time copied, at its place, as vertex `n + j`, `j` its rank in that order
//!    (`first_seen`); each ear copied over the copies as triangle `(n − 2) + k`, `k` its rank;
//! 6. each corner's offset direction, before any moves (`direction`);
//! 7. each of the `n` corners moved by `thickness` times its direction — the ears face down, so
//!    the corners go down —, the copies staying;
//! 8. the band stitched along the ring from its start: for ring corners `a = ring[i]`,
//!    `b = ring[i + 1]` and their copies `c`, `d`, the triangles `[b, a, d]` then `[a, c, d]`, as
//!    triangles `2(n − 2) + 2i` and `2(n − 2) + 2i + 1`;
//! 9. the offset being positive, each copied ear turned to face out, `[a, b, c]` to `[b, a, c]`.
//!
//! Every append of steps 5 and 8 is taken — the copy is a second disk, and the band holds each
//! ring side once more and each of its own sides twice — so no id is freed: the vertices are the
//! moved corners then the copies, the triangles the ears, the turned copies, then the band. The
//! groups, normals and texture coordinates the reference also sets move no vertex and change no
//! triangle; they are left out.
use super::super::topology::components;
use crate::hlod::flatten::first_seen::first_seen;
use crate::hlod::flatten::mesh::Mesh;
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vec3::{unit_where, unit_where_squared};
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The square length a corner's summed direction must pass to be scaled to unit length: the
/// reference's small number, a single-precision `1e-8` widened.
const LEAST_DIRECTION_SQUARE: f64 = 1.0e-8f32 as f64;
/// The square length a ring side must pass to have a direction: the reference's larger small
/// number, a single-precision `1e-4` widened; a shorter side is parallel to any.
const LEAST_SIDE_SQUARE: f64 = 1.0e-4f32 as f64;
/// The least magnitude of the cosine between two parallel sides: one less that larger small
/// number, in single precision, widened.
const PARALLEL_COSINE: f64 = (1.0f32 - 1.0e-4f32) as f64;

/// `v` scaled to unit length — times the reciprocal of its length — when that length is above
/// zero, the zero vector otherwise.
fn unit_or_zero(v: [f64; 3]) -> [f64; 3] {
    unit_where(v, |length| length > 0.0).unwrap_or([0.0; 3])
}

/// The offset direction of corner `v` of `mesh` over `points` (step 6): over its triangles in the
/// order the mesh visits them (`Mesh::triangles_at`), the sum, from zero, of each one's interior
/// angle at `v` — the arc cosine of the dot of its two sides from there, each scaled to unit
/// length (`unit_or_zero`), held in `[−1, 1]` — times its unit normal `(c − a) × (b − a)`; scaled
/// to unit length when its square passes `LEAST_DIRECTION_SQUARE`, else as it is.
fn direction(mesh: &Mesh, points: &[[f64; 3]], v: usize) -> [f64; 3] {
    let mut sum = [0.0; 3];
    for t in mesh.triangles_at(v) {
        let triangle = mesh.triangles[t];
        let Some(k) = (0..3).find(|&k| triangle[k] == v) else {
            continue;
        };
        let corners = triangle.map(|corner| points[corner]);
        let along = |j: usize| unit_or_zero(sub(corners[j], corners[k]));
        let cosine = dot(along((k + 1) % 3), along((k + 2) % 3));
        let angle = cosine.clamp(-1.0, 1.0).acos();
        let [a, b, c] = corners;
        sum = add(sum, scale(unit_or_zero(triangle_cross(a, c, b)), angle));
    }
    unit_where_squared(sum, |square| square > LEAST_DIRECTION_SQUARE).unwrap_or(sum)
}

/// Whether ring sides `first` and `second` are parallel (step 4): each its lower vertex less its
/// higher, scaled to unit length when its square passes `LEAST_SIDE_SQUARE`; parallel when either
/// is too short, or when the magnitude of their dot reaches `PARALLEL_COSINE`.
fn parallel(points: &[[f64; 3]], first: [usize; 2], second: [usize; 2]) -> bool {
    let along = |[a, b]: [usize; 2]| {
        let (low, high) = (a.min(b), a.max(b));
        unit_where_squared(sub(points[low], points[high]), |square| {
            square > LEAST_SIDE_SQUARE
        })
    };
    match (along(first), along(second)) {
        (Some(u), Some(w)) => dot(u, w).abs() >= PARALLEL_COSINE,
        _ => true,
    }
}

/// The boundary ring of the polygon over `points`, from corner `first` up the hull, turned by its
/// sides' groups (steps 3 and 4).
fn boundary_ring(points: &[[f64; 3]], first: usize) -> Vec<usize> {
    let n = points.len();
    let side = |k: usize| [(first + k) % n, (first + k + 1) % n];
    let mut groups = vec![0; n];
    let mut fresh = 1;
    let mut last = n - 1;
    while last > 0 && parallel(points, side(0), side(last)) {
        groups[last] = groups[0];
        last -= 1;
    }
    for j in 1..=last {
        groups[j] = if parallel(points, side(j), side(j - 1)) {
            groups[j - 1]
        } else {
            fresh += 1;
            fresh - 1
        };
    }
    let turn = if groups[0] == groups[n - 1] {
        (0..n - 1)
            .find(|&k| groups[k] != groups[k + 1])
            .map_or(0, |k| k + 1)
    } else {
        0
    };
    (0..n).map(|k| (first + turn + k) % n).collect()
}

/// The slab `thickness` deep, above zero, under the polygon of `points` — at the cap's height, in
/// the reference's frame — triangulated by `ears` (module doc): its vertices and triangles in the
/// order the reference's mesh holds them.
pub(super) fn slab(
    points: Vec<[f64; 3]>,
    ears: Vec<[usize; 3]>,
    thickness: f64,
) -> (Vec<[f64; 3]>, Vec<[usize; 3]>) {
    let n = points.len();
    let region: Vec<usize> = (components(&ears).into_iter())
        .flat_map(|(own, _)| own)
        .collect();
    let ring = boundary_ring(&points, ears[0][0]);
    let (originals, ranks) = first_seen(region.iter().flat_map(|&t| ears[t]).collect());
    let mut copy_of = vec![0; n];
    for (j, &v) in originals.iter().enumerate() {
        copy_of[v] = n + j;
    }
    let mut mesh = Mesh::with_vertices(n);
    for &ear in &ears {
        // The ears of one disk: every one is taken, as the reference's mesh takes it.
        let _ = mesh.append(ear);
    }
    let directions: Vec<[f64; 3]> = (0..n).map(|v| direction(&mesh, &points, v)).collect();
    let mut vertices: Vec<[f64; 3]> = (points.iter().zip(&directions))
        .map(|(&p, &d)| add(p, scale(d, thickness)))
        .collect();
    vertices.extend(originals.iter().map(|&v| points[v]));
    let mut triangles = ears;
    let copies = ranks.as_chunks::<3>().0.iter();
    triangles.extend(copies.map(|&[a, b, c]| [b, a, c].map(|r| n + r as usize)));
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (c, d) = (copy_of[a], copy_of[b]);
        triangles.push([b, a, d]);
        triangles.push([a, c, d]);
    }
    (vertices, triangles)
}
