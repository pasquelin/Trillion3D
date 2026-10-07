//! The planar mode of an ETC2 colour block (`etc2.rs`): three corner colours —
//! origin, horizontal, vertical — on 6, 7 and 6 bits, every texel on the plane
//! through them, which bands no gradient. A decoder tells it from the other
//! modes by the overflow of the differential fields it shares bits with: red
//! and green stay in range, blue does not, and the free bits are set to make it so.
use super::etc2::{gap, rgb, Rgb};
use super::fit::Texels;

/// The planar block: origin, horizontal and vertical corners by least squares
/// on the sixteen texels, on 6, 7 and 6 bits.
pub(super) fn planar(texels: &Texels) -> (i32, [u8; 8]) {
    let bits = [6, 7, 6];
    let mut corners = [[0i32; 3]; 3];
    for (c, &width) in bits.iter().enumerate() {
        let values: [f32; 16] = texels.map(|t| t[c]);
        let mean = values.iter().sum::<f32>() / 16.0;
        let (mut dx, mut dy) = (0.0f32, 0.0f32);
        for (i, v) in values.iter().enumerate() {
            dx += ((i % 4) as f32 - 1.5) * v / 20.0;
            dy += ((i / 4) as f32 - 1.5) * v / 20.0;
        }
        let origin = mean - 1.5 * dx - 1.5 * dy;
        let top = f32::from((1u8 << width) - 1);
        for (k, value) in [origin, origin + 4.0 * dx, origin + 4.0 * dy]
            .iter()
            .enumerate()
        {
            corners[k][c] = (value * top / 255.0).round().clamp(0.0, top) as i32;
        }
    }
    let expand = |q: i32, c: usize| (q << (8 - bits[c])) | (q >> (2 * bits[c] - 8));
    let [o, h, v] = corners.map(|q| [0, 1, 2].map(|c| expand(q[c], c)));
    let mut error = 0;
    for (i, texel) in texels.iter().enumerate() {
        let (x, y) = ((i % 4) as i32, (i / 4) as i32);
        let decoded: Rgb = std::array::from_fn(|c| {
            ((x * (h[c] - o[c]) + y * (v[c] - o[c]) + 4 * o[c] + 2) >> 2).clamp(0, 255)
        });
        error += gap(rgb(texel), decoded);
    }
    (error, planar_bytes(corners))
}

/// Value of a byte's top five bits plus its low three as a signed step: what a
/// decoder adds to tell the differential mode from the others.
fn stepped(byte: u8) -> i32 {
    i32::from(byte >> 3) + (i32::from(byte & 7) ^ 4) - 4
}

/// Packs the planar corners `[origin, horizontal, vertical]` (R, G, B each),
/// setting the free bits so that red and green stay in range and blue does not:
/// how a decoder recognises the planar mode.
fn planar_bytes([o, h, v]: [[i32; 3]; 3]) -> [u8; 8] {
    let bit = |value: i32, at: u32| ((value >> at) & 1) as u8;
    let mut b = [0u8; 8];
    b[0] = ((o[0] << 1) as u8 & 0x7e) | bit(o[1], 6);
    b[1] = ((o[1] << 1) as u8 & 0x7e) | bit(o[2], 5);
    b[2] = ((o[2] & 0x18) as u8) | ((o[2] >> 1) as u8 & 3);
    b[3] = bit(o[2], 0) << 7 | ((h[0] >> 1) as u8 & 0x1f) << 2 | 2 | bit(h[0], 0);
    b[4] = (h[1] as u8) << 1 | bit(h[2], 5);
    b[5] = ((h[2] & 0x1f) as u8) << 3 | (v[0] >> 3) as u8 & 7;
    b[6] = ((v[0] & 7) as u8) << 5 | (v[1] >> 2) as u8 & 0x1f;
    b[7] = ((v[1] & 3) as u8) << 6 | v[2] as u8 & 0x3f;
    for byte in &mut b[..2] {
        if !(0..=31).contains(&stepped(*byte)) {
            *byte |= 0x80;
        }
    }
    if (0..=31).contains(&stepped(b[2] | 0xe0)) {
        b[2] |= 4;
    } else {
        b[2] |= 0xe0;
    }
    b
}
