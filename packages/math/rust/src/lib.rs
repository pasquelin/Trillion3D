//! The Rust maths primitives, each written once for the page codec (`packages/page-codec-wasm`,
//! whose WebAssembly kernels twin `packages/math/src`) and the native compiler:
//!
//! - `vector`: `vec3` and `vec2`, vector algebra on `[f64; 3]` (its normalisations, and its
//!   single-precision forms) and `[f64; 2]` (the plane cross product, signed area and barycentric
//!   weights); `vecn`, vectors of any width in either precision (their sum, difference, scale, dot
//!   product and length, their lerp, weighted sums and means); `octahedral`, the octahedral map
//!   of a normal on two bytes;
//! - `scalar`: lerp and mix, remap, the unit interval on a byte, Hermite's cubic, means; `js`,
//!   JavaScript's `Math.min`, `Math.max` and `Math.hypot`, to the bit; `real`, the `f32` or `f64`
//!   a matrix is composed in; `acos` and `trig`, fdlibm's arc cosine and sine, the same bits on
//!   every host;
//! - `matrix`: the 4×4 product of `multiplyMatrix4` in either, affine point and direction
//!   transforms, and the translation, scaling and glTF composition of a node; `linear`, a
//!   matrix's linear part, its determinants, column lengths and decomposition; `rotation` and
//!   `euler`, rotation matrices, Euler orders and their composition;
//! - `quaternion`: quaternions and the animation's slerp;
//! - `geometry`: `aabb`, axis-aligned boxes grown by points and by boxes, their corners, sides and
//!   diagonal; `box_transform`, a box moved by a matrix; `ray_box`, crossed by a ray; `triangle`,
//!   a triangle's cross product, area, closest point and ray hit, an edge's key, the corners of a
//!   triangle's three, Newell's normal; `sphere`, bounding spheres merged;
//! - `sequence`: `random`, the seeded xorshift, congruential and SplitMix generators, and the word
//!   hash and Murmur hashes;
//! - `color`: the sRGB transfer curve, its power fdlibm's;
//! - `heap`: the indexed binary heap every queue of the compiler and the codec pops from;
//! - `join`: the union-find every stage joins with, a group named by its least or greatest id;
//! - `golden`: the reference values of `packages/math/golden`, for the twins' tests.

pub mod color;
#[cfg(any(test, feature = "golden"))]
pub mod golden;
pub mod matrix;
pub mod quaternion;
pub mod scalar;

/// The golden ratio's fractional part as an odd 64-bit integer: the step of the seeded draws.
pub const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// `GOLDEN` on 32 bits: its high half, the fractional part of the golden ratio times 2³².
pub const GOLDEN_32: u32 = 0x9E37_79B9;

pub mod geometry;
pub mod heap;
pub mod join;
pub mod sequence;
#[cfg(test)]
mod tests;
pub mod vector;
