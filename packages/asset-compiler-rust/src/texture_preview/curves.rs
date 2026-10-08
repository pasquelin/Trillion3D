//! Chain curves: the one that brings an sRGB byte back to linear, the neutral
//! table of a linear byte, and the one that turns a linear value into an sRGB
//! byte. Split from reduction because they depend only on the atlas format, never
//! on the geometry of the levels.
use trillion3d_math::color::{linear_to_srgb_f32, srgb_to_linear_f32};
use trillion3d_math::scalar::{byte_to_unit_f32, unit_to_byte_f32};

/// The 256 linear-byte values, at their scale: the neutral table.
pub(super) fn linear_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            *slot = byte_to_unit_f32(value as u8);
        }
        table
    })
}

/// The 256 sRGB-byte values in linear, built once for the whole compilation: the `f32` curve
/// (`srgb_to_linear_f32`), whose rounding the box average accumulates in `f32` then in `f64`.
pub(super) fn srgb_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            *slot = srgb_to_linear_f32(byte_to_unit_f32(value as u8));
        }
        table
    })
}

/// A linear value as an sRGB byte: the `f32` curve, clamped to `[0, 1]`, times 255, rounded.
pub(crate) fn linear_to_srgb(value: f32) -> u8 {
    unit_to_byte_f32(linear_to_srgb_f32(value))
}
