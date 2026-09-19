//! Chain curves: the one that brings an sRGB byte back to linear, the neutral
//! table of a linear byte, and the one that turns a linear value into an sRGB
//! byte. Split from reduction because they depend only on the atlas format, never
//! on the geometry of the levels.
/// The 256 linear-byte values, at their scale: the neutral table.
pub(super) fn linear_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            *slot = value as f32 / 255.0;
        }
        table
    })
}

/// The 256 sRGB-byte values in linear, built once for the whole compilation.
///
/// The same curve as `albedo.rs::srgb_to_linear`, but in `f32`: 214 of the 256
/// entries differ from the rounded `f64` version, and the box average accumulates
/// in `f32` then in `f64`. Replacing the table with a call would change the
/// preview bytes; both copies stay.
pub(super) fn srgb_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            let encoded = value as f32 / 255.0;
            *slot = if encoded <= 0.04045 {
                encoded / 12.92
            } else {
                ((encoded + 0.055) / 1.055).powf(2.4)
            };
        }
        table
    })
}

pub(super) fn linear_to_srgb(value: f32) -> u8 {
    let encoded = if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (encoded.clamp(0.0, 1.0) * 255.0).round() as u8
}
