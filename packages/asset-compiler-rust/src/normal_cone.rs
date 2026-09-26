//! The normal cone of a cluster: the axis and half-angle that bound its triangles' normals, by
//! which the WebGPU cut rejects a cluster that faces away. Cooked here once per page into the
//! manifest (`docs/FORMAT.md`, `pages[].cone`), so the runtime reads no vertex for it.
//!
//! It is `triangleCone` (`tests/kit/cone.ts`), which the prepare ran until #272, operation for
//! operation in float64. The axis keeps its bits, `Math.hypot` ported as V8 computes it. The angle
//! cannot: V8's `Math.acos` bits follow the machine (on arm64, one input in two hundred differs from
//! fdlibm), so it is fdlibm's (`libm`, the same bits everywhere) raised by [`ANGLE_MARGIN_ULPS`]:
//! never narrower than any runtime's, and a wider cone only culls less
//! (`tests/integration/cooked-cones.test.ts`).
use crate::shared_math::{cross, divide, dot, sub};

/// How many ulps the angle is raised by. fdlibm and the runtime's arccosine each lie within one ulp
/// of the true angle, an ulp of which is at most two ulps of fdlibm's result where it crosses a
/// power of two: four steps up from fdlibm's result reach past any runtime's.
pub(crate) const ANGLE_MARGIN_ULPS: usize = 4;

/// A cone that never rejects (`OPEN_CONE`): axis +Z, half-angle π.
pub(crate) const OPEN_CONE: [f64; 4] = [0.0, 0.0, 1.0, std::f64::consts::PI];

/// The cross product of a triangle's two edges from its first corner, in float64.
fn face_cross(pos: &[f32], a: usize, b: usize, c: usize) -> [f64; 3] {
    let at = |i: usize| [pos[i] as f64, pos[i + 1] as f64, pos[i + 2] as f64];
    let origin = at(a);
    cross(sub(at(b), origin), sub(at(c), origin))
}

/// `Math.hypot(x, y, z)` as V8 computes it: every magnitude divided by the largest, the squares
/// summed with Kahan compensation, the root scaled back. The specification leaves `Math.hypot`
/// approximated; this is the rounding Chrome and Node return, where a plain `sqrt` of the squares
/// differs in the last bit on a large share of inputs.
pub(crate) fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let values = [x.abs(), y.abs(), z.abs()];
    let max = values
        .iter()
        .filter(|v| !v.is_nan())
        .fold(0.0f64, |max, &v| if v > max { v } else { max });
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

/// The bounding cone of the normals of `indices`' triangles over `pos`, as `[x, y, z, angle]`.
/// Degenerate faces are skipped; with none left, or normals that cancel out, the cone is open.
pub(crate) fn triangle_cone(pos: &[f32], indices: &[u32]) -> [f64; 4] {
    // Each face's cross product and length once: the same values both passes of the TypeScript
    // recompute, so the bits do not change.
    let faces: Vec<([f64; 3], f64)> = indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter_map(|&[i, j, k]| {
            let c = face_cross(pos, i as usize * 3, j as usize * 3, k as usize * 3);
            let len = hypot3(c[0], c[1], c[2]);
            (len > 0.0).then_some((c, len))
        })
        .collect();
    if faces.is_empty() {
        return OPEN_CONE;
    }
    let (mut sx, mut sy, mut sz) = (0.0f64, 0.0f64, 0.0f64);
    for (c, _) in &faces {
        sx += c[0];
        sy += c[1];
        sz += c[2];
    }
    let sl = hypot3(sx, sy, sz);
    // `!(sl > 0)` in the TypeScript: a NaN length opens the cone as a zero one does.
    if sl.is_nan() || sl <= 0.0 {
        return OPEN_CONE;
    }
    let axis = divide([sx, sy, sz], sl);
    let mut angle = 0.0f64;
    for &(c, len) in &faces {
        let d = (dot(c, axis) / len).clamp(-1.0, 1.0);
        let a = libm::acos(d);
        if a > angle {
            angle = a;
        }
    }
    let angle = (0..ANGLE_MARGIN_ULPS).fold(angle, |angle, _| angle.next_up());
    [axis[0], axis[1], axis[2], angle]
}

/// The cone of a page as the manifest spells it (`Page.cone`): `{"axis": [x, y, z], "angle": a}`.
pub(crate) fn cone_json(pos: &[f32], indices: &[u32]) -> serde_json::Value {
    let [x, y, z, angle] = triangle_cone(pos, indices);
    serde_json::json!({"axis": [x, y, z], "angle": angle})
}

#[cfg(test)]
#[path = "normal_cone_tests.rs"]
mod tests;
