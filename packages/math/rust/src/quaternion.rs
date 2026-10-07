//! Quaternions as four floats `(x, y, z, w)` (a driver reading `(w, x, y, z)` says so). Two
//! normalisations, which round apart and keep apart: `normalize`, the bits of JavaScript's
//! `normalizeQuaternion` (`packages/math/src/quaternion/quaternion.ts`) for the animation sampler,
//! and `divide` by `length`, the plain root of the squares the scene drivers use. The slerp's arc
//! and weights are those of `slerpArc` and `slerpOnArc`, with fdlibm's arc cosine and sine.

use crate::acos::acos;
use crate::js::{compensated_squares, hypot, js_min};
use crate::real::Real;
use crate::trig;

/// The squared length `normalize` takes unscaled between these two, `2^-900` and `2^900`
/// (`SQUARED_MIN`, `SQUARED_MAX` of `packages/math/src/quaternion/quaternion.ts`).
pub const SQUARED_MIN: f64 = f64::from_bits(0x07B0_0000_0000_0000);
pub const SQUARED_MAX: f64 = f64::from_bits(0x7830_0000_0000_0000);

/// The squares of `q` summed in order, `((x² + y²) + z²) + w²`.
#[inline]
pub fn length_squared<T: Real>(q: [T; 4]) -> T {
    q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]
}

/// The root of `length_squared`.
#[inline]
pub fn length<T: Real>(q: [T; 4]) -> T {
    length_squared(q).sqrt()
}

/// Each part divided by `k`: not a product by `1 / k`, which rounds once more.
#[inline]
pub fn divide<T: Real>(q: [T; 4], k: T) -> [T; 4] {
    q.map(|part| part / k)
}

/// `normalizeQuaternion` on the four floats of `q`: the compensated sum of the squares unscaled
/// between `SQUARED_MIN` and `SQUARED_MAX`, the scaled length of `Math.hypot` outside, a zero or
/// NaN length taken as `1`.
#[inline]
pub fn normalize(q: &mut [f64]) {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let squared = compensated_squares([x, y, z, w]);
    let length = if (SQUARED_MIN..=SQUARED_MAX).contains(&squared) {
        squared.sqrt()
    } else {
        // `hypot4(x, y, z, w) || 1`.
        let h = hypot([x, y, z, w]);
        if h == 0.0 || h.is_nan() {
            1.0
        } else {
            h
        }
    };
    q[0] = x / length;
    q[1] = y / length;
    q[2] = z / length;
    q[3] = w / length;
}

/// The four products summed in order, `((a₀b₀ + a₁b₁) + a₂b₂) + a₃b₃`.
#[inline]
pub fn dot(a: [f64; 4], b: [f64; 4]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

/// `slerpArc` from `a` to `b`: `[side, angle, sine]`, the side `-1` when the shorter arc goes to
/// `-b`, the angle `acos(min(1, |a·b|))` and its sine.
#[inline]
pub fn slerp_arc(a: [f64; 4], b: [f64; 4]) -> [f64; 3] {
    let mut cos = dot(a, b);
    let sign = if cos < 0.0 { -1.0 } else { 1.0 };
    cos *= sign;
    let angle = acos(js_min(1.0, cos));
    [sign, angle, trig::sin(angle)]
}

/// `slerpOnArc`: the weights of `a` and of `b` at `w` along the arc `[side, angle, sine]`, the
/// line's under a sine of `1e-6`, the side carried by `b`'s.
#[inline]
pub fn slerp_weights(w: f64, [sign, angle, sin]: [f64; 3]) -> [f64; 2] {
    if sin < 1e-6 {
        [1.0 - w, w * sign]
    } else {
        [
            trig::sin((1.0 - w) * angle) / sin,
            (trig::sin(w * angle) / sin) * sign,
        ]
    }
}

#[cfg(test)]
#[path = "quaternion_tests.rs"]
mod tests;
