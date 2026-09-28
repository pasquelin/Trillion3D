//! The normal cone of a cluster: the axis and half-angle that bound its triangles' normals, by
//! which the WebGPU cut rejects a cluster that faces away. Cooked here once per page into the
//! manifest (`docs/FORMAT.md`, `pages[].cone`), so the runtime reads no vertex for it; and built
//! by the same function, through the SDK module (`wasm_cone.rs`), for the pages the world cuts at
//! run time (`packages/sdk-browser/src/world/page/runtimeCut.ts`). This is the only cone builder.
//!
//! Two cones are built and the narrower kept (#929). The mean cone is `triangleCone`
//! (`tests/kit/cone.ts`), which the prepare ran until #272, operation for operation in float64:
//! its axis keeps its bits, `Math.hypot` ported as V8 computes it. Its angle cannot: V8's
//! `Math.acos` bits follow the machine (on arm64, one input in two hundred differs from fdlibm),
//! so it is fdlibm's (`libm`, the same bits everywhere) raised by [`ANGLE_MARGIN_ULPS`]. The
//! narrowest cone points at the centre of the smallest ball holding the unit normals, its angle
//! raised by an absolute margin. Either bounds every face on any runtime, and a wider cone only
//! culls less (`tests/integration/cooked-cones.test.ts`).
use crate::min_ball::min_ball;
use crate::vec3::{cross, divide, dot, point, sub};

/// How many ulps the angle is raised by. fdlibm and the runtime's arccosine each lie within one ulp
/// of the true angle, an ulp of which is at most two ulps of fdlibm's result where it crosses a
/// power of two: four steps up from fdlibm's result reach past any runtime's.
pub(crate) const ANGLE_MARGIN_ULPS: usize = 4;

/// A cone that never rejects (`OPEN_CONE`): axis +Z, half-angle π.
pub const OPEN_CONE: [f64; 4] = [0.0, 0.0, 1.0, std::f64::consts::PI];

/// The cross product of a triangle's two edges from its first corner, in float64.
fn face_cross(pos: &[f32], triangle: [u32; 3]) -> [f64; 3] {
    let [a, b, c] = triangle.map(|vertex| point(pos, vertex));
    cross(sub(b, a), sub(c, a))
}

/// `Math.hypot(x, y, z)` as V8 computes it: every magnitude divided by the largest, the squares
/// summed with Kahan compensation, the root scaled back. The specification leaves `Math.hypot`
/// approximated; this is the rounding Chrome and Node return, where a plain `sqrt` of the squares
/// differs in the last bit on a large share of inputs.
pub(crate) fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let values = [x.abs(), y.abs(), z.abs()];
    // `f64::max` passes over a NaN, as V8 takes the largest of the others.
    let max = values[0].max(values[1]).max(values[2]);
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if values.iter().any(|v| v.is_nan()) {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// The bounding cone of the normals of `indices`' triangles over `pos`, as `[x, y, z, angle]`:
/// the narrower of the mean cone and the narrowest cone, never looser than the mean one (#929).
/// Degenerate faces are skipped; with none left, or normals that cancel out, the cone is open.
pub fn triangle_cone(pos: &[f32], indices: &[u32]) -> [f64; 4] {
    let faces = faces(pos, indices);
    let mean = mean_cone(&faces);
    match narrowest_cone(&faces) {
        Some(narrow) if narrow[3] < mean[3] => narrow,
        _ => mean,
    }
}

/// Each non-degenerate face's cross product and its length, once: the same values both passes of
/// the TypeScript recompute, so the bits do not change.
pub(crate) fn faces(pos: &[f32], indices: &[u32]) -> Vec<([f64; 3], f64)> {
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter_map(|&triangle| {
            let c = face_cross(pos, triangle);
            let len = hypot3(c[0], c[1], c[2]);
            (len > 0.0).then_some((c, len))
        })
        .collect()
}

/// `triangleCone`'s cone: the axis of the summed face normals, bit for bit, and the widest face
/// angle from it, the margin up.
pub(crate) fn mean_cone(faces: &[([f64; 3], f64)]) -> [f64; 4] {
    if faces.is_empty() {
        return OPEN_CONE;
    }
    let s = faces.iter().fold([0.0f64; 3], |s, (c, _)| {
        [s[0] + c[0], s[1] + c[1], s[2] + c[2]]
    });
    let sl = hypot3(s[0], s[1], s[2]);
    // `!(sl > 0)` in the TypeScript: a NaN length opens the cone as a zero one does.
    if sl.is_nan() || sl <= 0.0 {
        return OPEN_CONE;
    }
    let axis = divide(s, sl);
    let angle = widest_angle(faces, axis);
    let angle = (0..ANGLE_MARGIN_ULPS).fold(angle, |angle, _| angle.next_up());
    [axis[0], axis[1], axis[2], angle]
}

/// The widest angle between `axis` and a face's normal, by fdlibm's arccosine. `f64::max` passes
/// over a NaN as the TypeScript's `a > angle` does.
fn widest_angle(faces: &[([f64; 3], f64)], axis: [f64; 3]) -> f64 {
    faces
        .iter()
        .map(|&(c, len)| libm::acos((dot(c, axis) / len).clamp(-1.0, 1.0)))
        .fold(0.0f64, f64::max)
}

/// Absolute margin of the narrowest cone's angle. Arccosine is ill-conditioned near an angle of
/// zero, where one ulp of the dot product is about 1.5e-8 rad: 1e-6 rad covers any runtime's
/// rounding of the containment test with room to spare.
const NARROWEST_MARGIN: f64 = 1e-6;

/// The cone whose axis points at the centre of the smallest ball enclosing the unit face normals
/// (`min_ball`), its angle measured on every face as the mean cone's is, raised by
/// [`NARROWEST_MARGIN`]; `None` when that centre is the origin, which gives no axis.
fn narrowest_cone(faces: &[([f64; 3], f64)]) -> Option<[f64; 4]> {
    let mut normals: Vec<[f64; 3]> = faces.iter().map(|&(c, len)| divide(c, len)).collect();
    let (centre, _) = min_ball(&mut normals)?;
    let length = hypot3(centre[0], centre[1], centre[2]);
    if !(length > 1e-9) {
        return None;
    }
    let axis = divide(centre, length);
    Some([
        axis[0],
        axis[1],
        axis[2],
        widest_angle(faces, axis) + NARROWEST_MARGIN,
    ])
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
