//! The normal cone of a cluster: the axis and half-angle that bound its triangles' normals, by
//! which the WebGPU cut rejects a cluster that faces away. Cooked here once per page and written
//! into the manifest (`docs/FORMAT.md` §Manifest binary), so the runtime reads it instead of
//! rebuilding it from the source vertices.
//!
//! The computation is `triangleCone` (`packages/sdk-browser/src/page/cone/build.ts`), operation
//! for operation in float64. The axis has the same bits: its only rounding beyond the four basic
//! operations is `Math.hypot`, ported below as V8 computes it. The angle cannot: `Math.acos` is
//! V8's own build of fdlibm, whose bits follow the machine (on the arm64 machine this was measured
//! on, they differ from fdlibm's in about one input in two hundred). Every implementation lies within one ulp of the true angle, so
//! the cooked angle is fdlibm's (the `libm` crate: the same bits on every machine the compiler runs
//! on) raised by [`ANGLE_MARGIN_ULPS`]: it is never narrower than the cone any runtime would have
//! built, and a wider cone only culls less. `tests/integration/cooked-cones.test.ts` proves both on
//! every compiled scene: the same axis bits, and an angle at least the runtime's, a few ulps wide.

/// How many ulps the angle is raised by. fdlibm and the runtime's arccosine each lie within one ulp
/// of the true angle, an ulp of which is at most two ulps of fdlibm's result where it crosses a
/// power of two: four steps up from fdlibm's result reach past any runtime's.
pub(crate) const ANGLE_MARGIN_ULPS: usize = 4;

/// A cone that never rejects (`OPEN_CONE`): axis +Z, half-angle π.
pub(crate) const OPEN_CONE: [f64; 4] = [0.0, 0.0, 1.0, std::f64::consts::PI];

/// The cross product of a triangle's two edges from its first corner, in float64.
fn face_cross(pos: &[f32], a: usize, b: usize, c: usize) -> [f64; 3] {
    let at = |i: usize| pos[i] as f64;
    let (ax, ay, az) = (at(a), at(a + 1), at(a + 2));
    let (e1x, e1y, e1z) = (at(b) - ax, at(b + 1) - ay, at(b + 2) - az);
    let (e2x, e2y, e2z) = (at(c) - ax, at(c + 1) - ay, at(c + 2) - az);
    [
        e1y * e2z - e1z * e2y,
        e1z * e2x - e1x * e2z,
        e1x * e2y - e1y * e2x,
    ]
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
    let faces = || {
        indices.as_chunks::<3>().0.iter().filter_map(|&[i, j, k]| {
            let c = face_cross(pos, i as usize * 3, j as usize * 3, k as usize * 3);
            let len = hypot3(c[0], c[1], c[2]);
            (len > 0.0).then_some((c, len))
        })
    };
    let (mut sx, mut sy, mut sz, mut count) = (0.0f64, 0.0f64, 0.0f64, 0usize);
    for (c, _) in faces() {
        sx += c[0];
        sy += c[1];
        sz += c[2];
        count += 1;
    }
    if count == 0 {
        return OPEN_CONE;
    }
    let sl = hypot3(sx, sy, sz);
    // `!(sl > 0)` in the TypeScript: a NaN length opens the cone as a zero one does.
    if sl.is_nan() || sl <= 0.0 {
        return OPEN_CONE;
    }
    let axis = [sx / sl, sy / sl, sz / sl];
    let mut angle = 0.0f64;
    for (c, len) in faces() {
        let d = ((c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2]) / len).clamp(-1.0, 1.0);
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
