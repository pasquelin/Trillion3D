//! The f32 vector products the tests build normals with: `trillion3d_math::vec3` holds the f64
//! cross product and the f32 length and divide, this the f32 cross in the same term order.

/// `a × b` in f32, each component `a.y·b.z − a.z·b.y` in turn, as `trillion3d_math::vec3::cross`.
pub(crate) fn cross_f32(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
