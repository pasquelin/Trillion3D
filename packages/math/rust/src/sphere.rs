//! Bounding spheres `[x, y, z, radius]` in `f64`, a negative radius for an empty one. The merge is
//! the recurrence of `sphereUnion` (`packages/math/src/geometry/sphere.ts`): sequential and
//! not commutative, so `enclosing_sphere` neither reorders nor splits its list.

use crate::vec3::{length, sub};

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

/// `spheres` merged in order from the empty sphere; no sphere gives the zero sphere at the origin.
/// The result encloses every input sphere.
pub fn enclosing_sphere(spheres: &[[f64; 4]]) -> [f64; 4] {
    let mut result = [0.0, 0.0, 0.0, -1.0];
    for &sphere in spheres {
        result = merge_spheres(result, sphere);
    }
    if result[3] < 0.0 {
        result[3] = 0.0;
    }
    result
}

#[cfg(test)]
#[path = "sphere_tests.rs"]
mod tests;
