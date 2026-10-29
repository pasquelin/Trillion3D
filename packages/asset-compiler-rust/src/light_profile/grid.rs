//! The candela grid of a profile resampled into the profile's square texture.
//!
//! Texel `(x, y)` is the direction at vertical angle `x / SIDE × 180°` and horizontal angle
//! `y / SIDE × 360°`; its value is the candela there, interpolated bilinearly in the grid's own
//! angles, divided by the greatest candela of the file. Rows are horizontal angles, the file's
//! symmetry (one plane, a quadrant, a half) unfolding them. All of it in single precision, the
//! texel rounded to the nearest even half-float.
use super::{Photometry, SIDE};
use half::f16;
use trillion3d_math::scalar::lerp;

const RAD_TO_DEG: f32 = 180.0 / std::f32::consts::PI;
/// Two angles closer than this are one: the position between them is the first's.
const ANGLE_EPSILON: f32 = 0.0001;

/// Where `value` falls among the ascending `sorted` angles: the index of the angle at or below it
/// plus the share of the way to the next; 0 below the first, the last index above the last.
fn position(value: f32, sorted: &[f32]) -> f32 {
    let last = sorted.len() - 1;
    if value < sorted[0] {
        return 0.0;
    }
    if value > sorted[last] {
        return last as f32;
    }
    let (mut low, mut high) = (0, last);
    while low < high {
        let test = (low + high + 1) / 2;
        if value >= sorted[test] {
            low = test;
        } else {
            high = test - 1;
        }
    }
    let mut share = 0.0;
    if low < last {
        let gap = sorted[low + 1] - sorted[low];
        if gap > ANGLE_EPSILON {
            share = (value - sorted[low]) / gap;
        }
    }
    low as f32 + share
}

impl Photometry {
    /// The candela of grid point (`h`, `v`), both wrapping round the grid.
    fn point(&self, h: i32, v: i32) -> f32 {
        let h = h as usize % self.h_angles.len();
        let v = v as usize % self.v_angles.len();
        self.candela[v + self.v_angles.len() * h]
    }

    /// The candela at the fractional grid position (`h`, `v`).
    fn bilinear(&self, h: f32, v: f32) -> f32 {
        let (hi, vi) = (h as i32, v as i32);
        let (share_h, share_v) = (h - hi as f32, v - vi as f32);
        let along_v = |hi| lerp(self.point(hi, vi), self.point(hi, vi + 1), share_v);
        lerp(along_v(hi), along_v(hi + 1), share_h)
    }

    /// The candela toward horizontal angle `h` and vertical angle `v`, in degrees.
    pub(super) fn candela_toward(&self, mut h: f32, v: f32) -> f32 {
        if self.type_a {
            let (sin_v, cos_v) = (v.to_radians().sin(), v.to_radians().cos());
            let x = cos_v;
            let y = sin_v * h.to_radians().sin();
            let z = sin_v * h.to_radians().cos();
            let new_v = z.clamp(-1.0, 1.0).asin() * RAD_TO_DEG;
            let new_h = -(y.atan2(x) * RAD_TO_DEG);
            return self.bilinear(
                position(new_h, &self.h_angles),
                position(new_v, &self.v_angles),
            );
        }
        // The file's symmetry: its horizontal angles stop at 0 (one plane), 90 (a quadrant), 180
        // (a half) or 360; an angle past the last folds back into them, mirrored in the odd
        // quadrants. An angle before the first, for a file that starts above 0, is mirrored too.
        let first = self.h_angles[0];
        let last = self.h_angles[self.h_angles.len() - 1];
        if last > 0.0 && h > last {
            let quadrant = ((h as i32) as f32 / last) as i32;
            h = if quadrant == 1 || quadrant == 3 {
                last - h % last
            } else {
                h % last
            };
        } else if first > 0.0 && h < first {
            h = last - first - h;
        }
        self.bilinear(position(h, &self.h_angles), position(v, &self.v_angles))
    }

    /// The profile's texture: `SIDE` × `SIDE` half-floats, row after row, the candela over the
    /// file's greatest. A file whose greatest is 0 or less gives texels that are not numbers, which
    /// the atlas turns to 0 as it takes them in.
    pub(super) fn texture(&self) -> Vec<u16> {
        let step = 1.0 / SIDE as f32;
        let inverse_max = 1.0 / self.max_candela;
        let mut texels = Vec::with_capacity(SIDE * SIDE);
        for row in 0..SIDE {
            let h = row as f32 * step * 360.0;
            for column in 0..SIDE {
                let v = column as f32 * step * 180.0;
                let value = inverse_max * self.candela_toward(h, v);
                texels.push(f16::from_f32(value).to_bits());
            }
        }
        texels
    }
}
