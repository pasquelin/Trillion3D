//! An entry's baked image brought down to its cell of the atlas (`grid.rs`): each axis filtered
//! apart by Mitchell and Netravali's cubic, both its parameters a third — two texels of support
//! on the cell's side, the weights of each cell texel summed to one —, the image's edges clamped,
//! every byte read as it is, a colour's too, and each channel rounded back to its byte.
use super::smear::Image;
use rayon::prelude::*;

/// The cubic's weight `x` texels of the smaller image from a texel's centre.
fn cubic(x: f64) -> f64 {
    let x = x.abs();
    if x < 1.0 {
        (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0
    } else if x < 2.0 {
        (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0
    } else {
        0.0
    }
}

/// Per texel of an axis `to` texels long read from one `from` texels long, `to` below `from`: the
/// source texels under the cubic's support around its centre, each its weight, the weights summed
/// to one, a texel past either end read as the edge's.
fn taps(from: usize, to: usize) -> Vec<Vec<(usize, f64)>> {
    let scale = to as f64 / from as f64;
    let support = 2.0 / scale;
    (0..to)
        .map(|n| {
            let centre = (n as f64 + 0.5) / scale;
            let first = (centre - support).floor() as i64;
            let last = (centre + support).ceil() as i64;
            let mut taps: Vec<(usize, f64)> = Vec::new();
            for i in first..=last {
                let weight = cubic((i as f64 + 0.5 - centre) * scale);
                if weight == 0.0 {
                    continue;
                }
                let at = i.clamp(0, from as i64 - 1) as usize;
                match taps.last_mut() {
                    Some((last, sum)) if *last == at => *sum += weight,
                    _ => taps.push((at, weight)),
                }
            }
            let total: f64 = taps.iter().map(|&(_, w)| w).sum();
            taps.iter_mut().for_each(|(_, w)| *w /= total);
            taps
        })
        .collect()
}

/// `image` resized to `width` by `height` texels, each smaller than the image's own side: the rows
/// filtered first, then the columns, in floats; each channel back to its byte, rounded.
pub(super) fn resized(image: &Image, (width, height): (usize, usize)) -> Image {
    let across = taps(image.width, width);
    let down = taps(image.height, height);
    // Each source row filtered along `x` to the target's width.
    let rows: Vec<[f64; 4]> = (0..image.height)
        .into_par_iter()
        .flat_map_iter(|y| {
            let row = &image.texels[y * image.width..(y + 1) * image.width];
            across.iter().map(move |taps| {
                let mut sum = [0.0; 4];
                for &(x, weight) in taps {
                    (0..4).for_each(|c| sum[c] += f64::from(row[x][c]) * weight);
                }
                sum
            })
        })
        .collect();
    let texels = (0..height)
        .into_par_iter()
        .flat_map_iter(|y| {
            let rows = &rows;
            let taps = &down[y];
            (0..width).map(move |x| {
                let mut sum = [0.0; 4];
                for &(row, weight) in taps {
                    let value = rows[row * width + x];
                    (0..4).for_each(|c| sum[c] += value[c] * weight);
                }
                sum.map(|v| v.round().clamp(0.0, 255.0) as u8)
            })
        })
        .collect();
    Image {
        width,
        height,
        texels,
    }
}
