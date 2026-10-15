//! The normal cone of a cluster: the axis and half-angle that bound its triangles' normals, by
//! which the WebGPU cut rejects a cluster that faces away. Cooked here once per page into the
//! manifest (`docs/FORMAT.md`, `pages[].cone`), so the runtime reads no vertex for it; and built
//! by the same function, through the SDK module (`wasm_cone.rs`), for the pages the world cuts at
//! run time (`packages/sdk-browser/src/world/page/runtimeCut.ts`). This is the only cone builder.
//!
//! One cone is built: the narrowest, whose axis points at the centre of the smallest ball holding
//! the unit face normals (`min_ball`). Below a half-turn it is the smallest cap holding them, so
//! never looser than any other axis's cone, the summed normals' included: the smallest cap of
//! angle θ* < π/2 sits in a ball of radius sin θ*, so the smallest ball has radius r ≤ sin θ* < 1;
//! a ball of radius under one cuts the unit sphere in a cap no wider than a hemisphere, whose
//! circle, of radius sin θ, lies in the ball: sin θ ≤ r ≤ sin θ*, θ ≤ θ*, and the widest normal
//! about the axis is θ*. At π/2 or more no view can cull the cluster by its cone: it is open. Its angle is measured by fdlibm's arccosine
//! (`trillion3d_math::acos`, the same bits everywhere; JavaScript's `Math.acos` follows the machine)
//! and raised by [`ANGLE_MARGIN_ULPS`], so it bounds every face on any runtime; a wider cone only
//! culls less (`tests/integration/cooked-cones.test.ts`).
use crate::min_ball::min_ball;
use trillion3d_math::js::hypot;
use trillion3d_math::triangle::triangle_cross;
use trillion3d_math::vec3::{divide, point};
use trillion3d_math::vecn::dot;

/// How many ulps the angle is raised by. fdlibm and the runtime's arccosine each lie within one ulp
/// of the true angle, an ulp of which is at most two ulps of fdlibm's result where it crosses a
/// power of two: four steps up from fdlibm's result reach past any runtime's.
pub(crate) const ANGLE_MARGIN_ULPS: usize = 4;

/// A cone that never rejects (`OPEN_CONE`): axis +Z, half-angle π.
pub const OPEN_CONE: [f64; 4] = [0.0, 0.0, 1.0, std::f64::consts::PI];

/// The cross product of a triangle's two edges from its first corner, in float64.
fn face_cross(pos: &[f32], triangle: [u32; 3]) -> [f64; 3] {
    let [a, b, c] = triangle.map(|vertex| point(pos, vertex));
    triangle_cross(a, b, c)
}

/// The bounding cone of the normals of `indices`' triangles over `pos`, as `[x, y, z, angle]`: the
/// narrowest (`narrowest_cone`). Degenerate faces are skipped; with none left, a normal that is not
/// a number, or normals that cancel out, the cone is open.
pub fn triangle_cone(pos: &[f32], indices: &[u32]) -> [f64; 4] {
    narrowest_cone(&faces(pos, indices)).unwrap_or(OPEN_CONE)
}

/// Each non-degenerate face's cross product and its length, once.
fn faces(pos: &[f32], indices: &[u32]) -> Vec<([f64; 3], f64)> {
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter_map(|&triangle| {
            let c = face_cross(pos, triangle);
            let len = hypot(c);
            (len > 0.0).then_some((c, len))
        })
        .collect()
}

/// The cone on `axis` holding every face: the widest face angle, the margin up.
fn raised_cone(faces: &[([f64; 3], f64)], axis: [f64; 3]) -> [f64; 4] {
    let angle = widest_angle(faces, axis);
    let angle = (0..ANGLE_MARGIN_ULPS).fold(angle, |angle, _| angle.next_up());
    [axis[0], axis[1], axis[2], angle]
}

/// The widest angle between `axis` and a face's normal, by fdlibm's arccosine: that of the
/// smallest cosine, one arccosine per cone rather than one per face. fdlibm's `acos` is
/// non-increasing — no adjacent pair of floats out of 2.16·10⁹ checked over `[-1, 1]` and around
/// every branch edge rises —, so it is the same float as the largest of the per-face angles; and
/// were a pair ever to rise, each lies within one ulp of the true, decreasing angle, which
/// [`ANGLE_MARGIN_ULPS`] covers. `f64::min` passes over a NaN, which never widens the cone;
/// no number at all leaves the angle `0`.
fn widest_angle(faces: &[([f64; 3], f64)], axis: [f64; 3]) -> f64 {
    let smallest = faces
        .iter()
        .map(|&(c, len)| (dot(c, axis) / len).clamp(-1.0, 1.0))
        .fold(f64::INFINITY, f64::min);
    if smallest == f64::INFINITY {
        0.0
    } else {
        trillion3d_math::acos::acos(smallest)
    }
}

/// The cone whose axis points at the centre of the smallest ball enclosing the unit face normals
/// (`min_ball`), its angle measured and raised (`raised_cone`), so the same bound holds on any
/// runtime; open from a quarter-turn up (nothing culls there); `None` when there is no face, a normal is not a number (a face with a non-finite
/// vertex) or the centre is the origin.
fn narrowest_cone(faces: &[([f64; 3], f64)]) -> Option<[f64; 4]> {
    let mut normals = Vec::with_capacity(faces.len());
    for &(c, len) in faces {
        let n = divide(c, len);
        if !n.iter().all(|v| v.is_finite()) {
            return None;
        }
        normals.push(n);
    }
    let (centre, _) = min_ball(&mut normals)?;
    let length = hypot(centre);
    if length.is_nan() || length <= 1e-9 {
        return None;
    }
    let cone = raised_cone(faces, divide(centre, length));
    Some(match cone[3] < std::f64::consts::FRAC_PI_2 {
        true => cone,
        false => OPEN_CONE,
    })
}

/// The cone of each cluster `[start, end)` of `ranges` over `indices`, written as four floats per
/// cluster into `out`: what the world's run-time cut asks of the SDK module (`wasm_cone.rs`).
/// `None`, with `out` untouched, when a range or an index falls outside what it was given.
pub fn cluster_cones(pos: &[f32], indices: &[u32], ranges: &[u32], out: &mut [f64]) -> Option<()> {
    let vertices = pos.len() / 3;
    let clusters = ranges.as_chunks::<2>().0;
    let fits = |&[start, end]: &[u32; 2]| {
        start <= end
            && indices
                .get(start as usize..end as usize)
                .is_some_and(|c| c.iter().all(|&v| (v as usize) < vertices))
    };
    if out.len() < clusters.len() * 4 || !clusters.iter().all(fits) {
        return None;
    }
    for (&[start, end], cone) in clusters.iter().zip(out.as_chunks_mut::<4>().0) {
        *cone = triangle_cone(pos, &indices[start as usize..end as usize]);
    }
    Some(())
}

#[cfg(test)]
#[path = "normal_cone_tests.rs"]
mod tests;
