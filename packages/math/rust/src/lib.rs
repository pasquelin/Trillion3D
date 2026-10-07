//! The Rust maths primitives, each written once for the page codec (`packages/page-codec-wasm`,
//! whose WebAssembly kernels twin `packages/math/src`) and the native compiler:
//!
//! - `vec3`: vector algebra on `[f64; 3]`;
//! - `js`: JavaScript's `Math.min`, `Math.max` and `Math.hypot`, to the bit;
//! - `real`: the `f32` or `f64` a matrix is composed in;
//! - `matrix`: the 4×4 product of `multiplyMatrix4` in either, and an affine point transform;
//! - `aabb`: axis-aligned boxes grown by points and by boxes;
//! - `acos`, `trig`: fdlibm's arc cosine and sine, the same bits on every host;
//! - `golden`: the reference values of `packages/math/golden`, for the twins' tests.

pub mod aabb;
pub mod acos;
#[cfg(any(test, feature = "golden"))]
pub mod golden;
pub mod js;
pub mod matrix;
pub mod real;
pub mod trig;
pub mod vec3;

/// The golden ratio's fractional part as an odd 64-bit integer: the step of the seeded draws.
pub const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

#[cfg(test)]
mod golden_tests;
