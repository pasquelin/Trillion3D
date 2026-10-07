//! The Rust maths primitives, each written once for the page codec (`packages/page-codec-wasm`,
//! whose WebAssembly kernels twin `packages/math/src`) and the native compiler:
//!
//! - `vec3`, `vec2`: vector algebra on `[f64; 3]` (its normalisations, and its single-precision
//!   forms) and `[f64; 2]` (the plane cross product, signed area and barycentric weights);
//! - `vecn`: vectors of any width in either precision, their lerp, weighted sums and means;
//! - `scalar`: lerp and mix, remap, the unit interval on a byte, Hermite's cubic, means;
//! - `js`: JavaScript's `Math.min`, `Math.max`, `Math.hypot` and their clamp to `[0, 1]`, to the
//!   bit;
//! - `real`: the `f32` or `f64` a matrix is composed in;
//! - `matrix`: the 4×4 product of `multiplyMatrix4` in either, affine point and direction
//!   transforms, and the translation, scaling and glTF composition of a node;
//! - `linear`: a matrix's linear part, its determinants, column lengths and decomposition;
//! - `rotation`, `quaternion`, `euler`: rotation matrices, quaternions and the animation's slerp,
//!   Euler orders and their composition;
//! - `aabb`, `box_transform`: axis-aligned boxes grown by points and by boxes, their corners,
//!   sides and diagonal, and moved by a matrix;
//! - `triangle`: a triangle's cross product, area, closest point and ray hit; Newell's normal;
//! - `octahedral`: the octahedral maps of a direction, on two bytes and on a square;
//! - `sphere`: bounding spheres merged;
//! - `random`: the seeded xorshift, congruential and SplitMix generators, and a word hash;
//! - `color`: the sRGB transfer curve;
//! - `acos`, `trig`: fdlibm's arc cosine and sine, the same bits on every host;
//! - `golden`: the reference values of `packages/math/golden`, for the twins' tests.

pub mod aabb;
pub mod acos;
pub mod box_transform;
pub mod color;
pub mod euler;
#[cfg(any(test, feature = "golden"))]
pub mod golden;
pub mod js;
pub mod linear;
pub mod matrix;
pub mod octahedral;
pub mod quaternion;
pub mod random;
pub mod real;
pub mod rotation;
pub mod scalar;
pub mod sphere;
pub mod triangle;
pub mod trig;
pub mod vec2;
pub mod vec3;
pub mod vecn;

/// The golden ratio's fractional part as an odd 64-bit integer: the step of the seeded draws.
pub const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// `GOLDEN` on 32 bits: its high half, the fractional part of the golden ratio times 2³².
pub const GOLDEN_32: u32 = 0x9E37_79B9;

#[cfg(test)]
mod golden_tests;

#[cfg(test)]
#[path = "constants_tests.rs"]
mod constants_tests;
