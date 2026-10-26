//! The 4-wide BVH over placed triangles, which the compiler's bakes and traces build over a scene's
//! triangles (`asset-compiler-rust`): its layout numbers and the median-split tree (`bvh.rs`).

pub mod bvh;

/// A length of `metres` in the object units of a mesh the largest world `scale` places; a missing,
/// zero or non-finite scale leaves it as is, nothing guessed. The compiler's streaming bundles'
/// bands map by it, so they follow one scale.
pub fn object_units(metres: f64, scale: Option<f64>) -> f64 {
    match scale {
        Some(value) if value.is_finite() && value > 0.0 => metres / value,
        _ => metres,
    }
}

/// BVH leaf triangles: leaf loop bounded by this count engine side.
pub const PROXY_LEAF_TRIANGLES: usize = 8;
/// Numbers per triangle: three world vertices, no normal — it is deduced from the triangle.
pub const PROXY_TRIANGLE_FLOATS: usize = 9;
/// Children of a node: four boxes tested at once, the nearest kept for the rest.
pub const PROXY_CHILDREN: usize = 4;
