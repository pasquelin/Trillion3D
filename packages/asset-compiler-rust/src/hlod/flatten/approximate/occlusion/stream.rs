//! The seeded stream the hidden-face test draws its extra rays and its triangle samples from: a
//! 32-bit linear congruential state, stepped as `state · 196314165 + 907633515`, wrapping, each
//! draw its top 23 bits read as the fraction of a single-precision number in `[1, 2)`, less one —
//! the same numbers for the same seed on every host.

use trillion3d_math::sequence::random::lcg32_fraction;

/// The stream's state.
pub(super) struct Stream(u32);

/// The least squared length a drawn point keeps (`Stream::direction`): `10⁻⁴` in single
/// precision, compared in double.
const LEAST_SQUARED: f32 = 1e-4;

impl Stream {
    /// The stream started at `seed`.
    pub(super) fn new(seed: u32) -> Self {
        Self(seed)
    }

    /// The next number in `[0, 1)` (`lcg32_fraction`).
    pub(super) fn fraction(&mut self) -> f32 {
        lcg32_fraction(&mut self.0)
    }

    /// A unit direction, uniform on the sphere: points of the cube `[-1, 1]³` drawn one axis after
    /// the other, each `fraction · 2 − 1` in single precision, until one lies in the unit ball and
    /// no nearer its centre than `LEAST_SQUARED`, then scaled by the inverse of its length. The
    /// cube is drawn up along its third axis and the direction swapped into the scene's `y` up,
    /// the second and third axes exchanged as a `y`-up scene is read into a `z`-up one.
    pub(super) fn direction(&mut self) -> [f64; 3] {
        loop {
            let v: [f64; 3] = std::array::from_fn(|_| f64::from(self.fraction() * 2.0 - 1.0));
            let squared = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
            if squared <= 1.0 && squared >= f64::from(LEAST_SQUARED) {
                let scale = 1.0 / squared.sqrt();
                return [v[0] * scale, v[2] * scale, v[1] * scale];
            }
        }
    }
}
