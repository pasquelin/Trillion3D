//! Triangles and polygons in space: the edge cross product and area, the barycentric weights, the
//! closest point to a query, a ray's hit, and Newell's polygon normal.

use crate::real::Real;
use crate::vec3::{cross, dot, length, sub};

/// `(b − a) × (c − a)`: the normal of the triangle by its winding, twice its area long.
#[inline]
pub fn triangle_cross(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    cross(sub(b, a), sub(c, a))
}

/// The area of the triangle, `length(triangle_cross) / 2`.
#[inline]
pub fn triangle_area(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> f64 {
    length(triangle_cross(a, b, c)) / 2.0
}

/// The three barycentric weights of a point given by the weights `v` and `w` of the second and
/// third corners: `[1 − v − w, v, w]`.
#[inline]
pub fn barycentric_weights(v: f64, w: f64) -> [f64; 3] {
    [1.0 - v - w, v, w]
}

/// The point of the triangle `a, b, c` closest to `p`, by its Voronoi regions in turn: a corner,
/// then an edge (`lerp` along it), else the face, `a + ab·v + ac·w`.
pub fn closest_point(p: [f64; 3], a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let (d3, d4) = (dot(ab, bp), dot(ac, bp));
    let cp = sub(p, c);
    let (d5, d6) = (dot(ab, cp), dot(ac, cp));
    let (vc, vb, va) = (d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4);
    let lerp = crate::vecn::lerp::<f64, 3>;
    if d3 >= 0.0 && d4 <= d3 {
        b
    } else if d6 >= 0.0 && d5 <= d6 {
        c
    } else if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        lerp(a, b, d1 / (d1 - d3))
    } else if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        lerp(a, c, d2 / (d2 - d6))
    } else if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        lerp(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6)))
    } else {
        let denom = 1.0 / (va + vb + vc);
        let (v, w) = (vb * denom, vc * denom);
        [0, 1, 2].map(|k| a[k] + ab[k] * v + ac[k] * w)
    }
}

/// Where the ray `origin + t·ray` meets the triangle `[a, b, c]`, either face, for `near < t <
/// far`: `t` and the barycentric weights `(u, v)` of `b` and `c`. A ray within `1e-12` of the
/// triangle's plane (`|det|`, the determinant of the edges and the ray) misses it.
pub fn ray_triangle(
    origin: [f64; 3],
    ray: [f64; 3],
    [a, b, c]: [[f64; 3]; 3],
    (near, far): (f64, f64),
) -> Option<(f64, [f64; 2])> {
    let edge0 = sub(b, a);
    let edge1 = sub(c, a);
    let perpendicular = cross(ray, edge1);
    let determinant = dot(edge0, perpendicular);
    if determinant.abs() < 1e-12 {
        return None;
    }
    let inverse = 1.0 / determinant;
    let offset = sub(origin, a);
    let u = dot(offset, perpendicular) * inverse;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let across = cross(offset, edge0);
    let v = dot(ray, across) * inverse;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let distance = dot(edge1, across) * inverse;
    if distance <= near || distance >= far {
        return None;
    }
    Some((distance, [u, v]))
}

/// One edge `here → next` of a polygon added to its Newell sum: axis `i` gains
/// `(hereⱼ − nextⱼ)·(hereₖ + nextₖ)`, `j = i + 1` and `k = i + 2` modulo 3.
#[inline]
pub fn newell_step<T: Real>(sum: &mut [T; 3], here: [T; 3], next: [T; 3]) {
    for (axis, part) in sum.iter_mut().enumerate() {
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        *part = *part + (here[u] - next[u]) * (here[v] + next[v]);
    }
}

/// Newell's normal of a closed ring of corners, from `+0.0`, edge by edge in ring order
/// (`newell_step`): normal to any polygon, planar or not, convex or not, twice its area long.
#[inline]
pub fn newell<T: Real>(ring: &[[T; 3]]) -> [T; 3] {
    let mut sum = [T::ZERO; 3];
    for (rank, &here) in ring.iter().enumerate() {
        newell_step(&mut sum, here, ring[(rank + 1) % ring.len()]);
    }
    sum
}

#[cfg(test)]
#[path = "triangle_tests.rs"]
mod tests;
