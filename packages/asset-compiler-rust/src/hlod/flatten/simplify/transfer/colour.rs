//! The colours the transfer works in, as the method's flattened materials convert them: a texel's
//! sRGB channel to linear through a table of the curve evaluated in double precision and rounded
//! once to single — `v * (1 / 12.92)` up to 0.04045, `(v * (1 / 1.055) + 0.0521327)^2.4` above —, its alpha
//! over 255 (`linear`); a linear colour's luminance by the weights of sRGB's primaries under its
//! D65 white (`luminance`); and back to bytes: sRGB by Giesen's table, alpha held in [0, 1], times
//! 255 plus a half, truncated (`srgb`), or every channel the latter (`quantized`).
use crate::dag::{alpha_byte, srgb_byte};
use std::sync::OnceLock;

/// A linear colour, red, green, blue and alpha, single precision.
pub(super) type Linear = [f32; 4];

/// The weights of red, green and blue in a linear colour's luminance: the luminance of sRGB's
/// primaries under its white, 0.2126390, 0.7151687 and 0.0721923, single precision.
const LUMINANCE: [f32; 3] = [0.212_639, 0.715_168_65, 0.072_192_32];

/// The linear value of each sRGB byte (module doc), built once.
fn table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        std::array::from_fn(|byte| {
            let v = byte as f64 / 255.0;
            let linear = match v <= 0.04045 {
                true => v * (1.0 / 12.92),
                false => (v * (1.0 / 1.055) + 0.0521327).powf(2.4),
            };
            linear as f32
        })
    })
}

/// The linear value of sRGB byte `byte`.
pub(super) fn grey(byte: u8) -> f32 {
    table()[byte as usize]
}

/// An sRGB texel as a linear colour: each colour channel through the table, alpha over 255.
pub(super) fn linear([r, g, b, a]: [u8; 4]) -> Linear {
    [grey(r), grey(g), grey(b), f32::from(a) * (1.0 / 255.0)]
}

/// The luminance of linear colour `c`.
pub(super) fn luminance(c: Linear) -> f32 {
    c[0] * LUMINANCE[0] + c[1] * LUMINANCE[1] + c[2] * LUMINANCE[2]
}

/// Linear colour `c` as an sRGB texel.
pub(super) fn srgb(c: Linear) -> [u8; 4] {
    [
        srgb_byte(c[0]),
        srgb_byte(c[1]),
        srgb_byte(c[2]),
        alpha_byte(c[3]),
    ]
}

/// The value `c` as a texel, each channel quantized as an alpha is.
pub(super) fn quantized(c: Linear) -> [u8; 4] {
    c.map(alpha_byte)
}
