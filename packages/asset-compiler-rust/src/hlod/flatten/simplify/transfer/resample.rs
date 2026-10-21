//! The grid brought to the atlas's side when they differ, as the method down samples its dilated
//! maps (`downsampled`): each texel of the atlas the mean of the grid's texels its square overlaps,
//! weighed by the area each overlaps — every value taken uniform over its texel —, the squares in
//! the unit square, double precision, each weight narrowed to single as it multiplies; a texel
//! overlapping less than a tenth of its own area zero. A normal map's texels then made unit again
//! (`renormalized`): unshifted, made unit when longer than 1e-7, shifted back.
use super::colour::Linear;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{add, dot, scale};

/// The share of a texel's area its overlap must pass to hold a value.
const LEAST_OVERLAP: f64 = 0.1;

/// The length at or under which a normal is not made unit.
const NO_LENGTH: f32 = 1e-7;

/// `grid`, `from` texels square, down sampled to `to` texels square (module doc). Every corner is a
/// number at or past zero, so the overlap's bounds are the plain least and greatest.
pub(super) fn downsampled<const N: usize>(
    grid: &[[f32; N]],
    from: usize,
    to: usize,
) -> Vec<[f32; N]> {
    let (unit, fine) = (1.0 / to as f64, 1.0 / from as f64);
    let span = from as f64;
    (0..to * to)
        .into_par_iter()
        .map(|at| {
            let (x, y) = (at % to, at / to);
            let low = [unit * x as f64, unit * y as f64];
            let high = [unit * (x + 1) as f64, unit * (y + 1) as f64];
            let first = low.map(|u| ((u * span).floor() as i32).max(0) as usize);
            let last = high.map(|u| ((u * span).ceil() as i32).min(from as i32) as usize);
            let (mut value, mut total) = ([0.0; N], 0.0f64);
            for j in first[1]..last[1] {
                for i in first[0]..last[0] {
                    let own_low = [fine * i as f64, fine * j as f64];
                    let own_high = [fine * (i + 1) as f64, fine * (j + 1) as f64];
                    let start = [own_low[0].max(low[0]), own_low[1].max(low[1])];
                    let end = [own_high[0].min(high[0]), own_high[1].min(high[1])];
                    let area = (end[0] - start[0]) * (end[1] - start[1]);
                    total += area;
                    value = add(value, scale(grid[j * from + i], area as f32));
                }
            }
            match total > LEAST_OVERLAP * unit * unit {
                true => scale(value, 1.0 / total as f32),
                false => [0.0; N],
            }
        })
        .collect()
}

/// `grid`'s normals made unit again (module doc).
pub(super) fn renormalized(grid: &mut [Linear]) {
    grid.par_iter_mut().for_each(|texel| {
        let mut v = [0, 1, 2].map(|c| texel[c] * 2.0 - 1.0);
        let length = f64::from(dot(v, v)).sqrt() as f32;
        if length.abs() > NO_LENGTH {
            v = scale(v, 1.0 / length);
        }
        (0..3).for_each(|c| texel[c] = (v[c] + 1.0) * 0.5);
    });
}
