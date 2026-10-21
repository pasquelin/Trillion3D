//! The frame a merged mesh's normal map is written in: the frame the engine rebuilds for a
//! triangle without tangents from its texture coordinates (`cluster/cotangentFrameWgsl.ts`), and
//! the tangent-space value a goal normal takes in it.
use trillion3d_math::vector::vec3::{cross, normalized_or};
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The cotangent frame about `n` of a triangle of edges `e1`, `e2` and texture deltas `d1`, `d2`:
/// `T` along `u`, `B` along `v`, both scaled by the longer's length.
pub(in crate::hlod) fn cotangent(
    n: [f64; 3],
    (e1, e2): ([f64; 3], [f64; 3]),
    (d1, d2): ([f64; 2], [f64; 2]),
) -> [[f64; 3]; 2] {
    let (p, q) = (cross(e2, n), cross(n, e1));
    let t = add(scale(p, d1[0]), scale(q, d2[0]));
    let b = add(scale(p, d1[1]), scale(q, d2[1]));
    let s = 1.0 / dot(t, t).max(dot(b, b)).max(1e-30).sqrt();
    [scale(t, s), scale(b, s)]
}

/// The tangent-space value whose bend of `n` over `[t, b]` gives `goal`, unit.
pub(super) fn tangent_space(goal: [f64; 3], n: [f64; 3], [t, b]: [[f64; 3]; 2]) -> [f64; 3] {
    let z = dot(goal, n);
    let plane = sub(goal, scale(n, z));
    let (tt, tb, bb) = (dot(t, t), dot(t, b), dot(b, b));
    let (rt, rb) = (dot(plane, t), dot(plane, b));
    let det = tt * bb - tb * tb;
    let xy = if det.abs() > 1e-20 {
        [(bb * rt - tb * rb) / det, (tt * rb - tb * rt) / det]
    } else {
        [0.0; 2]
    };
    normalized_or([xy[0], -xy[1], z], [0.0, 0.0, 1.0])
}
