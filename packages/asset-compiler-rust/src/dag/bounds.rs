use trillion3d_math::aabb::{aabb_of, centre};
use trillion3d_math::vec3::{length, point, sub};

/// Monotone parent bounds: the sphere enclosing every input sphere, merged in order.
pub use trillion3d_math::sphere::enclosing_sphere;

/// AABB centre plus the farthest vertex. Conservative and deterministic.
pub fn bounding_sphere(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let (min, max) = aabb_of(indices.iter().map(|&id| point(positions, id)));
    if !min[0].is_finite() {
        return [0.0, 0.0, 0.0, 0.0];
    }
    let centre = centre(min, max);
    let mut radius = 0.0_f64;
    for &id in indices {
        let p = point(positions, id);
        let d = length(sub(p, centre));
        if d > radius {
            radius = d;
        }
    }
    [centre[0], centre[1], centre[2], radius]
}

/// Box of the vertices a cluster's triangles use; an empty cluster, or one whose low x is not
/// finite, gets a zero box.
pub(crate) fn cluster_bounds(positions: &[f32], indices: &[u32]) -> ([f64; 3], [f64; 3]) {
    let (min, max) = aabb_of(indices.iter().map(|&id| point(positions, id)));
    if !min[0].is_finite() {
        return ([0.0; 3], [0.0; 3]);
    }
    (min, max)
}
