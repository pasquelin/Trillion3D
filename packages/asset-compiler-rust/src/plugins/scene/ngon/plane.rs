//! Plane predicates of the cut: the Newell normal that picks the plane, and the signed areas
//! that say which side of a segment a point falls on.

/// Newell sum of a ring: a vector normal to the polygon, of length twice its area. The formula
/// holds for any face, planar or not, and assumes no convexity.
pub(super) fn newell(ring: &[[f64; 3]]) -> [f64; 3] {
    let mut sum = [0.0f64; 3];
    for (rank, here) in ring.iter().enumerate() {
        let next = ring[(rank + 1) % ring.len()];
        for (axis, part) in sum.iter_mut().enumerate() {
            let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
            *part += (here[u] - next[u]) * (here[v] + next[v]);
        }
    }
    sum
}

/// Cross product of two points of the plane: twice the signed area of the triangle they close
/// with the origin.
fn cross([x0, y0]: [f64; 2], [x1, y1]: [f64; 2]) -> f64 {
    x0 * y1 - y0 * x1
}

/// On which side of the segment `from`–`to` a point falls: twice the signed area of their
/// triangle.
pub(super) fn side(from: [f64; 2], to: [f64; 2], point: [f64; 2]) -> f64 {
    let edge = [to[0] - from[0], to[1] - from[1]];
    cross(edge, [point[0] - from[0], point[1] - from[1]])
}
