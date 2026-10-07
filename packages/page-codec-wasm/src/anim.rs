//! The animation sampler: every track of one action sampled at one clip time from packed arrays
//! (`packages/sdk-browser/src/animation/batchAnimation.ts` packs them), the twin term by term of
//! `sample` (`packages/sdk-core/src/world/animation/sample.ts`): the same key search, weights,
//! cubic spline, slerp along the arc kept per key segment (`slerpArc`/`slerpOnArc`, the
//! `slerp_arc`/`slerp_weights` of `trillion3d_math::quaternion`), and the same quaternion
//! normalisation (`normalizeQuaternion`, its `normalize`), with JavaScript's `Math.min` and
//! `Math.max` (`trillion3d_math::js`).
//!
//! A track is described by `TRACK_WORDS` words: where its times start in `data`, its key count
//! (one at least), where its values start, its width, its kind (`QUATERNION` bit, interpolation in
//! the bits above) and where its sample starts in `out`. A quaternion track is four wide.

use trillion3d_math::js::{js_max, js_min};
use trillion3d_math::quaternion::{normalize, slerp_arc, slerp_weights};

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
                let key = |at: usize| [v(at), v(at + 1), v(at + 2), v(at + 3)];
                arc[1..].copy_from_slice(&slerp_arc(key(a), key(b)));
            }
            arc[0] = i as f64;
            let [wa, wb] = slerp_weights(w, [arc[1], arc[2], arc[3]]);
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
