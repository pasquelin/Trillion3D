//! What a probe gathers over the passes: the spherical harmonics of the light its paths bring,
//! the paths that held, the sky's bent normal, the sun's shadowing, and the texel they make.
use super::kernel::PathResult;
use super::sampling::Vec3;
use super::store::{Texel, BENT, TEXEL_FLOATS};
use super::windowing;
use trillion3d_math::scalar::unit_to_byte_f32;

/// Passes the sun's shadowing takes.
pub const SHADOWING_PASSES: u32 = 32;

/// The spherical harmonics of a probe's light, three channels of nine coefficients, and the
/// paths that made them.
#[derive(Clone, Copy)]
pub struct Accumulator {
    pub harmonics: [[f32; 9]; 3],
    /// The sky's bent normal the paths of the upper half gathered, summed.
    pub bent: [f32; 3],
    pub count: u32,
    pub shadowing: u8,
    /// The nearest surface any usable path met first, in metres; infinite where none met one.
    pub nearest: f32,
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

impl Default for Accumulator {
    fn default() -> Self {
        Self {
            harmonics: [[0.0; 9]; 3],
            bent: [0.0; 3],
            count: 0,
            shadowing: 0,
            nearest: f32::INFINITY,
        }
    }
}

impl Accumulator {
    pub fn add(&mut self, result: &PathResult) {
        let b = basis(result.direction);
        for (channel, sh) in self.harmonics.iter_mut().enumerate() {
            for (k, coefficient) in sh.iter_mut().enumerate() {
                *coefficient += b[k] * result.radiance[channel] as f32;
            }
        }
        for (sum, part) in self.bent.iter_mut().zip(result.bent) {
            *sum += part as f32;
        }
        self.nearest = self.nearest.min(result.nearest as f32);
    }

    /// One more ray toward the sun: visible or not, rounded to the byte the way the format does.
    pub fn shadow(&mut self, visible: bool) {
        let added = f32::from(u8::from(visible)) / SHADOWING_PASSES as f32;
        let sum = (f32::from(self.shadowing) / 255.0 + added).min(1.0);
        self.shadowing = unit_to_byte_f32(sum);
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
/// [0, 1], the mean bent normal mapped the same way, and the sun's shadowing; the harmonics smoothed
/// by `smoothing` first (`windowing.rs`).
pub fn texel_of(accumulator: &Accumulator, smoothing: f64) -> Texel {
    let mut texel = [0.0f32; TEXEL_FLOATS];
    let count = accumulator.count as f32;
    let mut mean = accumulator.harmonics.map(|sh| sh.map(|c| c / count));
    windowing::smooth(&mut mean, smoothing);
    for channel in 0..3 {
        let sh = &mean[channel];
        let ambient = sh[0];
        texel[channel] = ambient;
        let inverse = 1.0 / ambient.max(0.0001);
        for half in 0..2 {
            for k in 0..4 {
                let value = sh[1 + half * 4 + k] * inverse * NORMALISATION[half][k];
                texel[3 + (channel * 2 + half) * 4 + k] = value * 0.5 + 0.5;
            }
        }
    }
    texel[27] = f32::from(accumulator.shadowing) / 255.0;
    for k in 0..3 {
        texel[BENT + k] = accumulator.bent[k] / count * 0.5 + 0.5;
    }
    texel
}

#[cfg(test)]
mod tests {
    use super::super::store::Store;
    use super::*;

    fn result(bent: Vec3) -> PathResult {
        PathResult {
            radiance: [1.0; 3],
            direction: [0.0, 1.0, 0.0],
            valid: true,
            bent,
            effect: None,
            nearest: f64::INFINITY,
        }
    }

    #[test]
    fn the_mean_bent_normal_is_mapped_to_unit_range_and_stored_with_the_alpha_of_nothing() {
        let mut accumulator = Accumulator::default();
        accumulator.add(&result([0.0, 1.0, 0.0]));
        accumulator.add(&result([0.5, 0.5, 0.0]));
        accumulator.count = 2;
        let texel = texel_of(&accumulator, 0.0);
        // The mean (0.25, 0.75, 0), from [-1, 1] to [0, 1].
        assert_eq!(&texel[BENT..], &[0.625, 0.875, 0.5]);
        let mut store = Store::new([1, 1, 1], true);
        store.write(0, &texel);
        assert_eq!(store.bent[0], [159, 223, 128, 128]);
        assert!((store.read(0)[BENT + 1] - 223.0 / 255.0).abs() < 1e-6);
    }
}
