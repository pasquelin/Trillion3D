//! The faces of a cluster as the compiler's plane stage reads them: each triangle's cross product,
//! in float64 (`face_crosses`).
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vec3::point;

/// Per triangle of `indices`, the cross product of its two edges from its first corner over `pos`,
/// in float64: what a cluster's plane (`coplanar::plane`) measures its faces by.
pub fn face_crosses(pos: &[f32], indices: &[u32]) -> Vec<[f64; 3]> {
    (indices.as_chunks::<3>().0.iter())
        .map(|triangle| {
            let [a, b, c] = triangle.map(|vertex| point(pos, vertex));
            triangle_cross(a, b, c)
        })
        .collect()
}
