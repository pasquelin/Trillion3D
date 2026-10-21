//! What the method samples at: the screen size, in pixels, the cell's actor is built for — its
//! sources' bounding sphere seen where the actor is first drawn, in the reference view
//! (`flatten::SCREEN`) —, and the voxel its volume is sampled on, from the bounds' largest side
//! over that pixel count, or the layer's own.
use crate::hlod::flatten::units::CENTIMETRES;
use crate::hlod::flatten::{screen_size, SCREEN};

/// The fewest and the most pixels the voxel is derived from.
const LEAST_PIXELS: i32 = 50;
const MOST_PIXELS: i32 = 900;

/// The pixels the bounding sphere of `radius` metres spans across the reference view's 1920 when
/// seen from `seen` metres: the share of the view it spans (`flatten::screen_size`) times the
/// view's width, rounded to the nearest whole pixel, a half up.
pub(super) fn pixels(radius: f64, seen: f64) -> i32 {
    (screen_size(radius, seen) * SCREEN.0 + 0.5).floor() as i32
}

/// The voxel, centimetres, the sources are sampled on: the layer's own (`voxel`, metres) when
/// it names one; else the length a pixel covers across the bounds' largest side `major`
/// (centimetres), the pixels held from 50 to 900, times 1.95 / 3 — 3 centimetres when the bounds
/// have no extent.
pub(super) fn voxel(pixels: i32, major: f32, own: Option<f64>) -> f64 {
    if let Some(own) = own {
        return f64::from((own * CENTIMETRES) as f32);
    }
    let count = pixels.clamp(LEAST_PIXELS, MOST_PIXELS);
    match major > 0.0 {
        true => f64::from(major) / f64::from(count) * 1.95 / 3.0,
        false => 3.0,
    }
}
