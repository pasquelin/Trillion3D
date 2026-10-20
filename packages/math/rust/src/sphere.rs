//! Bounding spheres `[x, y, z, radius]` in `f64`, a negative radius for an empty one. The merge is
//! the recurrence of `sphereUnion` (`packages/math/src/geometry/sphere.ts`): sequential and not
//! commutative. The smallest sphere of many is the page codec's `ball_of_balls`.

use crate::vecn::{length, sub};

/// The sphere enclosing `left` and `right`: either one when it holds the other, else the sphere
/// through their two far points, its centre moved from `left`'s along the line of centres.
#[inline]
pub fn merge_spheres(left: [f64; 4], right: [f64; 4]) -> [f64; 4] {
    if right[3] < 0.0 {
        return left;
    }
    if left[3] < 0.0 {
        return right;
    }
    let delta = sub([right[0], right[1], right[2]], [left[0], left[1], left[2]]);
    let distance = length(delta);
    if distance + right[3] <= left[3] {
        return left;
    }
    if distance + left[3] <= right[3] {
        return right;
    }
    let radius = (distance + left[3] + right[3]) * 0.5;
    let t = if distance > 0.0 {
        (radius - left[3]) / distance
    } else {
        0.0
    };
    [
        left[0] + delta[0] * t,
        left[1] + delta[1] * t,
        left[2] + delta[2] * t,
        radius,
    ]
}

/// The radius a ball centred on `c` needs to hold every `(centre, radius)` ball of `balls`, a
/// point being a ball of radius 0.
pub fn farthest(c: [f64; 3], balls: impl IntoIterator<Item = ([f64; 3], f64)>) -> f64 {
    balls
        .into_iter()
        .map(|(p, r)| length(sub(p, c)) + r)
        .fold(0.0, f64::max)
}

#[cfg(test)]
#[path = "sphere_tests.rs"]
mod tests;
