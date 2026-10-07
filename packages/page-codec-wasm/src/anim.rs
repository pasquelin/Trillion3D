//! The animation sampler: every track of one action sampled at one clip time from packed arrays
//! (`packages/sdk-browser/src/animation/batchAnimation.ts` packs them), the twin term by term of
//! `sample` (`packages/sdk-core/src/world/animation/sample.ts`): the same key search, weights,
//! cubic spline, slerp along the arc kept per key segment (the arc cosine and sine of `acos.rs`
//! and `trig.rs`, as `slerpArc`/`slerpOnArc`), and the same quaternion normalisation
//! (`normalizeQuaternion`), with JavaScript's `Math.min`, `Math.max` and `Math.hypot` (`math.rs`).
//!
//! A track is described by `TRACK_WORDS` words: where its times start in `data`, its key count
//! (one at least), where its values start, its width, its kind (`QUATERNION` bit, interpolation in
//! the bits above) and where its sample starts in `out`. A quaternion track is four wide.

use crate::math::{compensated_squares, hypot, js_max, js_min};

/// Words describing one track.
pub const TRACK_WORDS: usize = 6;
/// Numbers of one track's arc: the key it starts at (−1: none yet), its side, angle and sine.
pub const ARC_VALUES: usize = 4;
/// Kind bit: the track holds rotations.
pub const QUATERNION: u32 = 1;
/// Interpolation, in the kind's bits above the first: a line, the earlier key, glTF's spline.
pub const LINEAR: u32 = 0;
pub const STEP: u32 = 1 << 1;
pub const CUBIC: u32 = 2 << 1;
const INTERPOLATION: u32 = 3 << 1;

/// The squared length `normalize` takes unscaled between these two, `2^-900` and `2^900`
/// (`SQUARED_MIN`, `SQUARED_MAX` of `packages/math/src/quaternion/quaternion.ts`).
const SQUARED_MIN: f64 = f64::from_bits(0x07B0_0000_0000_0000);
const SQUARED_MAX: f64 = f64::from_bits(0x7830_0000_0000_0000);

/// `normalizeQuaternion` on `q`: the compensated sum of the squares unscaled between
/// `SQUARED_MIN` and `SQUARED_MAX`, the scaled length of `Math.hypot` outside.
fn normalize(q: &mut [f64]) {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let squared = compensated_squares([x, y, z, w]);
    let length = if (SQUARED_MIN..=SQUARED_MAX).contains(&squared) {
        squared.sqrt()
    } else {
        // `hypot4(x, y, z, w) || 1`.
        let h = hypot([x, y, z, w]);
        if h == 0.0 || h.is_nan() {
            1.0
        } else {
            h
        }
    };
    q[0] = x / length;
    q[1] = y / length;
    q[2] = z / length;
    q[3] = w / length;
}

/// Every track of `tracks` (`TRACK_WORDS` words each) sampled at `t`: its key kept in `keys`, its
/// arc in `arcs` (`ARC_VALUES` each), its numbers written in `out`.
pub fn sample_tracks(
    tracks: &[u32],
    data: &[f32],
    keys: &mut [u32],
    arcs: &mut [f64],
    out: &mut [f64],
    t: f64,
) {
    for (k, track) in tracks.as_chunks::<TRACK_WORDS>().0.iter().enumerate() {
        let [times_at, count, values_at, size, _, out_at] = track.map(|word| word as usize);
        let kind = track[4];
        let quaternion = kind & QUATERNION != 0;
        let times = &data[times_at..times_at + count];
        let cubic = kind & INTERPOLATION == CUBIC;
        let stride = if cubic { size * 3 } else { size };
        let at = if cubic { size } else { 0 };
        let values = &data[values_at..values_at + count * stride];
        let key = keys[k] as usize;
        let mut i = if key > 0 && f64::from(times[key]) < t {
            key
        } else {
            0
        };
        while i < count - 1 && f64::from(times[i + 1]) <= t {
            i += 1;
        }
        keys[k] = i as u32;
        let j = (i + 1).min(count - 1);
        let span = f64::from(times[j]) - f64::from(times[i]);
        let w = if span > 0.0 {
            js_min(1.0, js_max(0.0, (t - f64::from(times[i])) / span))
        } else {
            0.0
        };
        let o = &mut out[out_at..out_at + size];
        let v = |index: usize| f64::from(values[index]);
        if kind & INTERPOLATION == STEP || w == 0.0 {
            for (c, slot) in o.iter_mut().enumerate() {
                *slot = v(i * stride + at + c);
            }
        } else if cubic {
            let w2 = w * w;
            let w3 = w2 * w;
            let a = 2.0 * w3 - 3.0 * w2 + 1.0;
            let b = w3 - 2.0 * w2 + w;
            let c1 = -2.0 * w3 + 3.0 * w2;
            let d = w3 - w2;
            for (c, slot) in o.iter_mut().enumerate() {
                *slot = a * v(i * stride + size + c)
                    + b * span * v(i * stride + 2 * size + c)
                    + c1 * v(j * stride + size + c)
                    + d * span * v(j * stride + c);
            }
        } else if quaternion {
            let arc = &mut arcs[k * ARC_VALUES..k * ARC_VALUES + ARC_VALUES];
            let (a, b) = (i * size, j * size);
            if arc[0] != i as f64 {
                // `slerpArc`.
                let mut cos =
                    v(a) * v(b) + v(a + 1) * v(b + 1) + v(a + 2) * v(b + 2) + v(a + 3) * v(b + 3);
                let sign = if cos < 0.0 { -1.0 } else { 1.0 };
                cos *= sign;
                let angle = crate::acos::acos(js_min(1.0, cos));
                arc[1] = sign;
                arc[2] = angle;
                arc[3] = crate::trig::sin(angle);
            }
            arc[0] = i as f64;
            // `slerpOnArc`.
            let (sign, angle, sin) = (arc[1], arc[2], arc[3]);
            let line = sin < 1e-6;
            let wa = if line {
                1.0 - w
            } else {
                crate::trig::sin((1.0 - w) * angle) / sin
            };
            let wb = if line {
                w * sign
            } else {
                (crate::trig::sin(w * angle) / sin) * sign
            };
            for (c, slot) in o.iter_mut().enumerate() {
                *slot = v(a + c) * wa + v(b + c) * wb;
            }
        } else {
            for (c, slot) in o.iter_mut().enumerate() {
                *slot = v(i * size + c) * (1.0 - w) + v(j * size + c) * w;
            }
        }
        if quaternion {
            normalize(o);
        }
    }
}

#[cfg(test)]
#[path = "anim_tests.rs"]
mod tests;
