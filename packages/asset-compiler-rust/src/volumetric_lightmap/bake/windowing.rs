//! The smoothing of a sample's spherical harmonics (`sphericalHarmonicSmoothing`): where highly
//! directional light rings them — unexpected black areas on the side opposite the light — each
//! band is scaled down by the window that brings the squared Laplacian of the light to a target,
//! the target being the reciprocal of the smoothing. Where the light does not ring (its squared
//! Laplacian is under the target) nothing changes.
//!
//! The window is the one of "Stupid Spherical Harmonics (SH) Tricks": the band `l` is scaled by
//! `1 / (1 + λ l²(l+1)²)`, `λ` found by Newton's method on the luminance of the three channels.

/// The smoothing held to its least: a smoothing of zero is the smallest number, an immense target.
const LEAST_SMOOTHING: f64 = 1e-8;
/// The greatest smoothing the target is made of.
const GREATEST_SMOOTHING: f64 = 1000.0;
/// Newton's iterations at most, and the step under which they stop.
const ITERATIONS: u32 = 100;
const STEP_EPSILON: f32 = 1e-4;
/// The luminance of a linear sRGB colour.
const LUMINANCE: [f32; 3] = [0.2126, 0.7152, 0.0722];

/// The squared Laplacian weight of band `l`.
fn weight(l: usize) -> f32 {
    (l * l * (l + 1) * (l + 1)) as f32
}

/// The coefficients of band `l` the squared Laplacian sums: the reference sums the orders −1 to `l`
/// of each band, so the first order of the second band is left out of its sum.
fn laplacian_orders(l: usize) -> std::ops::RangeInclusive<usize> {
    l * (l + 1) - 1..=l * (l + 1) + l
}

/// The `λ` that brings the squared Laplacian of `sh`, nine coefficients, down to `target`
/// squared; zero where it is already under it.
fn find_lambda(sh: &[f32; 9], target: f32) -> f32 {
    let bands: [(f32, f32); 2] = std::array::from_fn(|k| {
        let l = k + 1;
        let energy: f32 = laplacian_orders(l).map(|i| sh[i] * sh[i]).sum();
        (weight(l), energy)
    });
    let squared: f32 = bands.iter().map(|(w, b)| w * b).sum();
    let target_squared = target * target;
    if squared <= target_squared {
        return 0.0;
    }
    let mut lambda = 0.0f32;
    for _ in 0..ITERATIONS {
        let (mut f, mut slope) = (0.0f32, 0.0f32);
        for (w, b) in bands {
            let t = 1.0 + lambda * w;
            f += w * b / (t * t);
            slope += 2.0 * w * w * b / (t * t * t);
        }
        let delta = -(target_squared - f) / slope;
        lambda += delta;
        if delta.abs() < STEP_EPSILON {
            break;
        }
    }
    lambda
}

/// Smooths the harmonics of the three channels in place by `smoothing`: the window found on their
/// luminance, applied to each channel.
pub fn smooth(harmonics: &mut [[f32; 9]; 3], smoothing: f64) {
    let target = (1.0 / smoothing.clamp(LEAST_SMOOTHING, GREATEST_SMOOTHING)) as f32;
    let luminance: [f32; 9] =
        std::array::from_fn(|i| (0..3).map(|c| harmonics[c][i] * LUMINANCE[c]).sum());
    let lambda = find_lambda(&luminance, target);
    if lambda == 0.0 {
        return;
    }
    for sh in harmonics.iter_mut() {
        for l in 1..3 {
            let scale = 1.0 / (1.0 + lambda * weight(l));
            for coefficient in &mut sh[l * l..(l + 1) * (l + 1)] {
                *coefficient *= scale;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_light_under_the_target_is_left_as_it_is() {
        let mut sh = [[0.5, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; 3];
        let before = sh;
        smooth(&mut sh, 0.02);
        assert_eq!(sh, before);
    }

    #[test]
    fn a_ringing_light_has_its_upper_bands_scaled_down_and_its_ambient_kept() {
        let mut sh = [[1.0, 0.0, 4.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0]; 3];
        smooth(&mut sh, 1.0);
        assert_eq!(sh[0][0], 1.0);
        assert!(sh[0][2] < 4.0 && sh[0][2] > 0.0);
        assert!(sh[0][6] < 3.0 && sh[0][6] > 0.0);
        assert_eq!(sh[0], sh[1]);
    }

    #[test]
    fn the_window_brings_the_laplacian_to_the_target() {
        let sh = [0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0];
        let lambda = find_lambda(&sh, 10.0);
        assert!(lambda > 0.0);
        let after: f32 = (1..3)
            .map(|l| {
                let scale = 1.0 / (1.0 + lambda * weight(l));
                weight(l)
                    * laplacian_orders(l)
                        .map(|i| (sh[i] * scale).powi(2))
                        .sum::<f32>()
            })
            .sum();
        assert!((after - 100.0).abs() < 0.5, "{after}");
    }
}
