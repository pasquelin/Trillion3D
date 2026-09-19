//! Sample bytes read as numbers, little-endian as the format writes them.
//!
//! A block whose length is not a multiple of the element size is truncated: leftover tail bytes
//! are left, which yields an array shorter than what the geometry asks for. The caller then
//! refuses, naming what was missing — never an out-of-bounds read.

/// The elements of a block, each read on `N` bytes.
fn values<const N: usize, T>(bytes: &[u8], from: fn([u8; N]) -> T) -> Vec<T> {
    bytes.as_chunks::<N>().0.iter().copied().map(from).collect()
}

pub(super) fn f32s(bytes: &[u8]) -> Vec<f32> {
    values(bytes, f32::from_le_bytes)
}

pub(super) fn f64s(bytes: &[u8]) -> Vec<f64> {
    values(bytes, f64::from_le_bytes)
}

pub(super) fn i32s(bytes: &[u8]) -> Vec<i32> {
    values(bytes, i32::from_le_bytes)
}

pub(super) fn u32s(bytes: &[u8]) -> Vec<u32> {
    values(bytes, u32::from_le_bytes)
}
