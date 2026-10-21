//! The sRGB transfer curve, in the precision each caller rounds in: `f64` and `f32` give different
//! floats on most of the 256 byte values, so each precision has its own function, its constants
//! written in that precision. The power is fdlibm's (`libm::pow`, `libm::powf`), the same bits on
//! every host: the platform's `powf` rounds apart from one C library to the next, and the baked
//! texture levels follow this curve.

/// An sRGB-encoded value in `[0, 1]` brought back to linear: `v / 12.92` up to `0.04045`,
/// `((v + 0.055) / 1.055)^2.4` above.
#[inline]
pub fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        libm::pow((value + 0.055) / 1.055, 2.4)
    }
}

/// An sRGB-encoded byte brought back to linear in `f64`: `srgb_to_linear` of the byte over 255.
#[inline]
pub fn srgb_byte_to_linear(byte: u8) -> f64 {
    srgb_to_linear(crate::scalar::byte_to_unit(byte))
}

/// `srgb_to_linear` in single precision.
#[inline]
pub fn srgb_to_linear_f32(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        libm::powf((value + 0.055) / 1.055, 2.4)
    }
}

/// A linear value encoded in sRGB, in single precision: `v · 12.92` up to `0.0031308`,
/// `1.055 · v^(1 / 2.4) − 0.055` above; not clamped.
#[inline]
pub fn linear_to_srgb_f32(value: f32) -> f32 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * libm::powf(value, 1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
mod tests;
