//! What a probe gathers over the passes: the spherical harmonics of the light its paths bring,
//! the paths that held, the sun's shadowing, and the texel they make.
use super::kernel::PathResult;
use super::sampling::Vec3;
use super::store::Texel;

/// Passes the sun's shadowing takes.
pub const SHADOWING_PASSES: u32 = 32;

/// The spherical harmonics of a probe's light, three channels of nine coefficients, and the
/// paths that made them.
#[derive(Clone, Copy, Default)]
pub struct Accumulator {
    pub harmonics: [[f32; 9]; 3],
    pub count: u32,
    pub shadowing: u8,
}

/// The nine spherical harmonics bases of the direction `d`.
fn basis(d: Vec3) -> [f32; 9] {
    let [x, y, z] = d;
    [
        0.282095,
        -0.488603 * y,
        0.488603 * z,
        -0.488603 * x,
        1.092548 * x * y,
        -1.092548 * y * z,
        0.315392 * (3.0 * z * z - 1.0),
        -1.092548 * x * z,
        0.546274 * (x * x - y * y),
    ]
    .map(|v| v as f32)
}

pub fn usable(result: &PathResult) -> bool {
    result.valid && result.radiance.iter().all(|c| c.is_finite() && *c >= 0.0)
}

impl Accumulator {
    pub fn add(&mut self, result: &PathResult) {
        let b = basis(result.direction);
        for (channel, sh) in self.harmonics.iter_mut().enumerate() {
            for (k, coefficient) in sh.iter_mut().enumerate() {
                *coefficient += b[k] * result.radiance[channel] as f32;
            }
        }
    }

    /// One more ray toward the sun: visible or not, rounded to the byte the way the format does.
    pub fn shadow(&mut self, visible: bool) {
        let added = f32::from(u8::from(visible)) / SHADOWING_PASSES as f32;
        let sum = (f32::from(self.shadowing) / 255.0 + added).min(1.0);
        self.shadowing = (sum * 255.0).round() as u8;
    }
}

/// The reference's normalisation of the coefficient vectors: each divided by its basis function's
/// scale relative to the ambient's.
const NORMALISATION: [[f32; 4]; 2] = [
    [
        0.282095 / 0.488603,
        0.282095 / 0.488603,
        0.282095 / 0.488603,
        0.282095 / 1.092548,
    ],
    [
        0.282095 / 1.092548,
        0.282095 / (4.0 * 0.315392),
        0.282095 / 1.092548,
        0.282095 / (2.0 * 0.546274),
    ],
];

/// The texel an accumulator makes: the mean ambient, the coefficients divided by it, mapped to
/// [0, 1], and the sun's shadowing.
pub fn texel_of(accumulator: &Accumulator) -> Texel {
    let mut texel = [0.0f32; 28];
    let count = accumulator.count as f32;
    for channel in 0..3 {
        let sh = &accumulator.harmonics[channel];
        let ambient = sh[0] / count;
        texel[channel] = ambient;
        let inverse = 1.0 / ambient.max(0.0001);
        for half in 0..2 {
            for k in 0..4 {
                let value = sh[1 + half * 4 + k] / count * inverse * NORMALISATION[half][k];
                texel[3 + (channel * 2 + half) * 4 + k] = value * 0.5 + 0.5;
            }
        }
    }
    texel[27] = f32::from(accumulator.shadowing) / 255.0;
    texel
}
