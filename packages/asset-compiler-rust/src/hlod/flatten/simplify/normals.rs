//! The simplified mesh's vertex normals (`vertex_normals`): each face's unit normal summed into its
//! three corners, weighted by the angle the face makes at the corner, by the area its corner's two
//! edges span, or alike, the sums made unit and turned round — the mesh winds its faces clockwise
//! seen from outside. Single precision throughout, as the method computes them.
//!
//! The vector routines follow the vector library the method was built on, whose source is not
//! shipped: a vector is made unit by dividing it by its length, zero staying zero; an angle is the
//! arc cosine of the clamped cosine by the seven-term approximation of Abramowitz and Stegun
//! (4.4.46), `√(1 − |x|) · Σ aᵢ |x|ⁱ`, reflected about π/2 for a negative cosine.
use crate::hlod::options::HlodNormalMethod;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, sub};

type V = [f32; 3];

/// `v` over its length, zero for a vector of no length.
pub(super) fn unit(v: V) -> V {
    let length = dot(v, v).sqrt();
    match length == 0.0 {
        true => [0.0; 3],
        false => v.map(|x| x / length),
    }
}

/// The coefficients of the arc cosine's approximation, lowest power first, as published; each
/// rounded to single precision where it is used.
const ARC: [f64; 8] = [
    1.570_796_305_0,
    -0.214_598_801_6,
    0.088_978_987_4,
    -0.050_174_304_6,
    0.030_891_881_0,
    -0.017_088_125_6,
    0.006_670_090_1,
    -0.001_262_491_1,
];

/// The arc cosine of `x` by the approximation (module doc).
fn arc_cosine(x: f32) -> f32 {
    let magnitude = x.abs();
    let root = (1.0 - magnitude).max(0.0).sqrt();
    let mut sum = ARC[7] as f32;
    for &a in ARC[..7].iter().rev() {
        sum = sum * magnitude + a as f32;
    }
    let angle = sum * root;
    match x >= 0.0 {
        true => angle,
        false => std::f32::consts::PI - angle,
    }
}

/// The angle at corner `p` between the edges towards `q` and `r`.
fn corner_angle(p: V, q: V, r: V) -> f32 {
    arc_cosine(dot(unit(sub(q, p)), unit(sub(r, p))).clamp(-1.0, 1.0))
}

/// The vertex normals of the clockwise mesh `points` and `indices`, its faces weighed at each
/// corner as `method` says (module doc).
pub(super) fn vertex_normals(points: &[V], indices: &[u32], method: HlodNormalMethod) -> Vec<V> {
    let mut sums = vec![[0.0f32; 3]; points.len()];
    for &t in indices.as_chunks::<3>().0 {
        let [i0, i1, i2] = t.map(|v| v as usize);
        let [p0, p1, p2] = [points[i0], points[i1], points[i2]];
        let (u, v) = (sub(p1, p0), sub(p2, p0));
        let face = unit(cross(u, v));
        let weights = match method {
            HlodNormalMethod::Equal => [1.0; 3],
            HlodNormalMethod::Angle => [
                corner_angle(p0, p1, p2),
                corner_angle(p1, p2, p0),
                corner_angle(p2, p0, p1),
            ],
            HlodNormalMethod::Area => {
                let span = |p: V, q: V, r: V| {
                    let c = cross(sub(q, p), sub(r, p));
                    dot(c, c).sqrt()
                };
                [span(p0, p1, p2), span(p1, p2, p0), span(p2, p0, p1)]
            }
        };
        for (vertex, weight) in [i0, i1, i2].into_iter().zip(weights) {
            let sum = &mut sums[vertex];
            match method {
                HlodNormalMethod::Equal => (0..3).for_each(|k| sum[k] += face[k]),
                _ => (0..3).for_each(|k| sum[k] += face[k] * weight),
            }
        }
    }
    sums.into_iter().map(|n| unit(n).map(|x| -x)).collect()
}
