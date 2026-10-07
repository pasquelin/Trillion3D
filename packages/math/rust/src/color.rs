//! The sRGB transfer curve, in the precision each caller rounds in: `f64` and `f32` give different
//! floats on most of the 256 byte values, so each precision has its own function, its constants
//! written in that precision.

/// An sRGB-encoded value in `[0, 1]` brought back to linear: `v / 12.92` up to `0.04045`,
/// `((v + 0.055) / 1.055)^2.4` above.
#[inline]
pub fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// `srgb_to_linear` in single precision.
#[inline]
pub fn srgb_to_linear_f32(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// A linear value encoded in sRGB, in single precision: `v · 12.92` up to `0.0031308`,
/// `1.055 · v^(1 / 2.4) − 0.055` above; not clamped.
#[inline]
pub fn linear_to_srgb_f32(value: f32) -> f32 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
#[path = "color_tests.rs"]
mod tests;
