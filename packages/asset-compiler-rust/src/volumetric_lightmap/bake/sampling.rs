//! The bake's sampling of directions: a basis around a normal, the hemisphere and cone
//! distributions with their densities, and the power heuristic that weighs two of them.
use std::f64::consts::PI;
use trillion3d_math::vector::vec3::frame_around;
use trillion3d_math::vector::vecn::{add, dot, scale};

pub type Vec3 = [f64; 3];

/// `v`, given in the frame whose third axis is `n`, in the world.
pub fn tangent_to_world(v: Vec3, n: Vec3) -> Vec3 {
    let (x, y) = frame_around(n);
    add(add(scale(x, v[0]), scale(y, v[1])), scale(n, v[2]))
}

/// A direction uniform over the hemisphere around +z, and its density `1 / 2π`.
pub fn uniform_hemisphere(e: [f64; 2]) -> (Vec3, f64) {
    let phi = 2.0 * PI * e[0];
    let cos_theta = e[1];
    let sin_theta = (1.0 - cos_theta * cos_theta).sqrt();
    (
        [sin_theta * phi.cos(), sin_theta * phi.sin(), cos_theta],
        1.0 / (2.0 * PI),
    )
}

/// A direction cosine-distributed around the unit `n`, and its density `cos / π`.
pub fn cosine_hemisphere_world(e: [f64; 2], n: Vec3) -> (Vec3, f64) {
    let phi = 2.0 * PI * e[0];
    let cos_theta = 1.0 - 2.0 * e[1];
    let sin_theta = (1.0 - cos_theta * cos_theta).sqrt();
    let u = [sin_theta * phi.cos(), sin_theta * phi.sin(), cos_theta];
    let sum = add(u, n);
    let length = dot(sum, sum).sqrt();
    let v = scale(sum, 1.0 / length);
    (v, dot(v, n).clamp(0.0, 1.0) / PI)
}

/// `1 - cos θ` of a cone whose half-angle has the sine squared `sin2`, stable for small cones.
pub fn one_minus_cos(sin2: f64) -> f64 {
    if sin2 < 0.01 {
        sin2 * (0.5 + 0.125 * sin2)
    } else {
        1.0 - (1.0 - sin2).sqrt()
    }
}

/// A direction uniform over the cone about +z of half-angle sine squared `sin2`, and its density
/// (infinite for a cone of no opening).
pub fn uniform_cone(e: [f64; 2], sin2: f64) -> (Vec3, f64) {
    let phi = 2.0 * PI * e[0];
    let opening = one_minus_cos(sin2);
    let cos_theta = 1.0 - opening * e[1];
    let sin_theta = (1.0 - cos_theta * cos_theta).max(0.0).sqrt();
    (
        [sin_theta * phi.cos(), sin_theta * phi.sin(), cos_theta],
        1.0 / (2.0 * PI * opening),
    )
}

/// The power heuristic's weight of the strategy of density `pdf` against another of `other`;
/// the two weights of a pair add to one, and an infinite density takes the whole.
pub fn power_heuristic(pdf: f64, other: f64) -> f64 {
    let ratio = pdf.min(other) / pdf.max(other);
    let y = if pdf == other { 1.0 } else { ratio };
    let m = 1.0 / (1.0 + y * y);
    if pdf > other {
        m
    } else {
        1.0 - m
    }
}

/// Whether `v` is above zero; a NaN is not.
pub fn positive(v: f64) -> bool {
    v > 0.0
}

/// The luminance of a linear colour.
pub fn luminance(c: Vec3) -> f64 {
    c[0] * 0.212_639_005_9 + c[1] * 0.715_168_678_8 + c[2] * 0.072_192_315_4
}
