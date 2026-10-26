//! The sky light of a bake: a flat sky, as a compile job holds no captured one. Its cube is one
//! over the horizon (the world's up, +y) and a colour under it, times the light's colour and
//! intensity, held at 0 or more. It is drawn by the brightest channel of its radiance, the
//! density a captured sky's importance map gives, which for two halves of a constant radiance is
//! one density over each half of the sphere.
use super::sampling::{tangent_to_world, uniform_hemisphere, Vec3};
use super::settings::SkySettings;
use std::f64::consts::PI;

/// The sky's radiance over the horizon and under it.
#[derive(Clone, Copy)]
pub struct Sky {
    pub upper: Vec3,
    pub lower: Vec3,
}

/// What a direction drawn toward the sky carries.
pub struct SkySample {
    pub direction: Vec3,
    pub radiance: Vec3,
    pub pdf: f64,
}

/// The brightest channel: what the sky is drawn by.
fn weight(radiance: Vec3) -> f64 {
    radiance[0].max(radiance[1]).max(radiance[2])
}

impl Sky {
    /// The sky `settings` name; none when it is black.
    pub fn of(settings: &SkySettings) -> Option<Self> {
        let radiance = |cube: Vec3| {
            [0, 1, 2].map(|k| (cube[k] * settings.color[k] * settings.intensity).max(0.0))
        };
        let sky = Self {
            upper: radiance([1.0; 3]),
            lower: radiance(settings.lower_hemisphere_color),
        };
        (sky.total() > 0.0).then_some(sky)
    }

    /// The weights of the two halves, summed: twice the mean over the sphere.
    fn total(&self) -> f64 {
        weight(self.upper) + weight(self.lower)
    }

    /// What the sky is worth in choosing a light: the sphere's solid angle times the mean weight.
    pub fn estimate(&self) -> f64 {
        2.0 * PI * self.total()
    }

    /// The radiance toward `direction` and the density it is drawn with, nothing where the half
    /// it lies in is black.
    pub fn eval(&self, direction: Vec3) -> (Vec3, f64) {
        let radiance = if direction[1] >= 0.0 {
            self.upper
        } else {
            self.lower
        };
        let share = weight(radiance);
        match share > 0.0 {
            true => (radiance, share / (2.0 * PI * self.total())),
            false => ([0.0; 3], 0.0),
        }
    }

    /// A direction drawn by `e`: the half by the first number, as its share of the weights, then
    /// uniform over the half, the first number stretched back over [0, 1).
    pub fn sample(&self, e: [f64; 2]) -> SkySample {
        let (upper, lower) = (weight(self.upper), weight(self.lower));
        let share = upper / (upper + lower);
        let (up, along) = match e[0] < share {
            true => (true, e[0] / share),
            false => (false, (e[0] - share) / (1.0 - share)),
        };
        let (local, _) = uniform_hemisphere([along, e[1]]);
        let direction = tangent_to_world(local, [0.0, if up { 1.0 } else { -1.0 }, 0.0]);
        let (radiance, drawn) = if up {
            (self.upper, upper)
        } else {
            (self.lower, lower)
        };
        SkySample {
            direction,
            radiance,
            pdf: drawn / (2.0 * PI * (upper + lower)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(lower: Vec3) -> SkySettings {
        SkySettings {
            lower_hemisphere_color: lower,
            ..SkySettings::default()
        }
    }

    #[test]
    fn a_black_sky_is_none_and_a_negative_radiance_is_held_at_zero() {
        let black = SkySettings {
            intensity: 0.0,
            ..SkySettings::default()
        };
        assert!(Sky::of(&black).is_none());
        let negative = SkySettings {
            color: [1.0, -3.0, 0.5],
            ..SkySettings::default()
        };
        assert_eq!(Sky::of(&negative).expect("sky").upper, [1.0, 0.0, 0.5]);
    }

    #[test]
    fn a_sky_over_a_black_lower_hemisphere_is_drawn_over_the_upper_half_only() {
        let sky = Sky::of(&settings([0.0; 3])).expect("sky");
        for k in 0..64 {
            let e = [f64::from(k) / 64.0, f64::from((k * 37) % 64) / 64.0];
            let sample = sky.sample(e);
            assert!(sample.direction[1] >= 0.0, "{:?}", sample.direction);
            assert!((sample.pdf - 1.0 / (2.0 * PI)).abs() < 1e-12);
        }
        assert_eq!(sky.eval([0.3, -0.5, 0.2]).1, 0.0);
    }

    #[test]
    fn the_density_of_a_sample_is_the_one_the_sky_gives_that_direction_and_integrates_to_one() {
        let sky = Sky::of(&settings([0.25, 0.1, 0.0])).expect("sky");
        // A uniform sphere of directions: the sum of density × solid angle is one.
        let n: i32 = 200;
        let mut sum = 0.0;
        for i in 0..n {
            for j in 0..n {
                let y = -1.0 + 2.0 * (f64::from(i) + 0.5) / f64::from(n);
                let phi = 2.0 * PI * (f64::from(j) + 0.5) / f64::from(n);
                let r = (1.0 - y * y).sqrt();
                sum += sky.eval([r * phi.cos(), y, r * phi.sin()]).1 * 4.0 * PI / f64::from(n * n);
            }
        }
        assert!((sum - 1.0).abs() < 1e-3, "{sum}");
        let sample = sky.sample([0.9, 0.3]);
        assert_eq!(sample.pdf, sky.eval(sample.direction).1);
    }
}
