//! Fitting of one channel of a 4 × 4 block to a segment of its own: what the
//! two-channel writers — BC5, the ASTC luminance-alpha block — do for X and
//! for Y, each on its ladder. The segment is the channel's extremes, the
//! endpoints are re-solved by `fit::solve` for the assigned rungs, in one
//! dimension, then clamped to a byte: no covariance, no axis, since a
//! channel's axis is the channel.
use super::fit::{nearest_rung, solve, Texels};
use trillion3d_math::scalar::remap;

/// Endpoints of `channel` on `ladder`, as bytes, and the rung of every texel on
/// what those bytes decode to.
pub fn fit_channel(texels: &Texels, channel: usize, ladder: &[f32]) -> (u8, u8, [u8; 16]) {
    let values: [f32; 16] = texels.map(|t| t[channel]);
    let (mut e0, mut e1) = (
        values.iter().copied().fold(f32::INFINITY, f32::min),
        values.iter().copied().fold(f32::NEG_INFINITY, f32::max),
    );
    let assign = |e0: f32, e1: f32| -> [u8; 16] {
        if (e1 - e0).abs() < 1e-6 {
            return [0; 16];
        }
        values.map(|v| nearest_rung(ladder, remap(v, e0, e1)))
    };
    let columns = values.map(|v| [v]);
    for _ in 0..3 {
        let rung = assign(e0, e1);
        let ([s0], [s1]) = solve(&columns, ladder, &rung, [e0], [e1]);
        (e0, e1) = (s0.clamp(0.0, 255.0), s1.clamp(0.0, 255.0));
    }
    let (b0, b1) = (e0.round() as u8, e1.round() as u8);
    (b0, b1, assign(f32::from(b0), f32::from(b1)))
}
