//! Fitting of one channel of a 4 × 4 block to a segment of its own: what the
//! two-channel writers — BC5, the ASTC luminance-alpha block — do for X and
//! for Y, each on its ladder. The segment is the channel's extremes, the
//! endpoints are re-solved by least squares for the assigned rungs as in
//! `fit.rs`, in one dimension: no covariance, no axis, since a channel's axis
//! is the channel.
use super::fit::{nearest_rung, Texels};

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
        values.map(|v| nearest_rung(ladder, (v - e0) / (e1 - e0)))
    };
    for _ in 0..3 {
        let rung = assign(e0, e1);
        let (mut a, mut b, mut c, mut x, mut y) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for (&v, &r) in values.iter().zip(&rung) {
            let w = ladder[r as usize];
            let u = 1.0 - w;
            a += u * u;
            b += u * w;
            c += w * w;
            x += v * u;
            y += v * w;
        }
        let det = a * c - b * b;
        if det.abs() < 1e-6 {
            break;
        }
        e0 = ((x * c - y * b) / det).clamp(0.0, 255.0);
        e1 = ((y * a - x * b) / det).clamp(0.0, 255.0);
    }
    let (b0, b1) = (e0.round() as u8, e1.round() as u8);
    (b0, b1, assign(f32::from(b0), f32::from(b1)))
}
