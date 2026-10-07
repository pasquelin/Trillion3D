//! The Rust maths primitives, each written once for the page codec (`packages/page-codec-wasm`,
//! whose WebAssembly kernels twin `packages/math/src`) and the native compiler:
//!
//! - `vec3`, `vec2`: vector algebra on `[f64; 3]` (and its single-precision forms) and `[f64; 2]`;
//! - `js`: JavaScript's `Math.min`, `Math.max` and `Math.hypot`, to the bit;
//! - `real`: the `f32` or `f64` a matrix is composed in;
//! - `matrix`: the 4×4 product of `multiplyMatrix4` in either, an affine point transform, and the
//!   translation, scaling and glTF composition of a node;
//! - `linear`: a matrix's linear part, its determinants, column lengths and decomposition;
//! - `rotation`, `quaternion`: rotation matrices, quaternions and the animation's slerp;
//! - `aabb`, `box_transform`: axis-aligned boxes grown by points and by boxes, and moved by a matrix;
//! - `sphere`: bounding spheres merged;
//! - `color`: the sRGB transfer curve;
//! - `acos`, `trig`: fdlibm's arc cosine and sine, the same bits on every host;
//! - `golden`: the reference values of `packages/math/golden`, for the twins' tests.

pub mod aabb;
pub mod acos;
pub mod box_transform;
pub mod color;
#[cfg(any(test, feature = "golden"))]
pub mod golden;
pub mod js;
pub mod linear;
pub mod matrix;
pub mod quaternion;
pub mod real;
pub mod rotation;
pub mod sphere;
pub mod trig;
pub mod vec2;
pub mod vec3;

/// The golden ratio's fractional part as an odd 64-bit integer: the step of the seeded draws.
pub const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

#[cfg(test)]
mod golden_tests;
