//! What the island merging weighs of a candidate, its triangles laid by their exponential map
//! seeded off their whole boundary (`expmap`):
//!
//! - its mean squared area distortion: per triangle the ratio of its larger to its smaller area,
//!   surface or map, held at `CLAMP_DISTORTION` — at it outright when the triangle is turned, its
//!   map's signed area positive, as a `z`-up mesh's map lays an unturned one negative —, squared
//!   and weighed by the surface area;
//! - its normal: each triangle's unit normal, as a `z`-up mesh winds it, times its area, summed and
//!   made unit;
//! - its compactness: the square root of the ratio of the larger to the smaller of the root of the
//!   map's area and its bounding box's area, both in square centimetres.
//!
//! A corner the map does not reach lies at the largest coordinates there are.
use super::base::Base;
use super::expmap::{expmap, Map, Seeding};
use super::CLAMP_DISTORTION;
use crate::hlod::flatten::units::SQUARE_CENTIMETRES;
use crate::hlod::flatten::uv::extremes::{least, most};
use trillion3d_math::vector::vec2::{cross as perp, double_area};
use trillion3d_math::vector::vec3::{cross, unit_or_itself};
use trillion3d_math::vector::vecn::{add, length, scale, sub};

/// What the merging weighs of an island candidate (module doc).
#[derive(Clone, Copy)]
pub(super) struct Metrics {
    pub(super) distortion: f64,
    pub(super) normal: [f64; 3],
    pub(super) compactness: f64,
}

/// The metrics of the triangles `triangles` of `base` (module doc).
pub(super) fn metrics(base: &Base, triangles: &[usize]) -> Metrics {
    let Map { corners, uv, .. } = expmap(base, triangles, Seeding::Boundary);
    let (mut sum, mut surface, mut laid) = (0.0f64, 0.0f64, 0.0f64);
    let mut normal = [0.0f64; 3];
    let (mut low, mut high) = ([f64::MAX; 2], [-f64::MAX; 2]);
    for (&t, local) in triangles.iter().zip(&corners) {
        let [a, b, c] = base.corners(t);
        let w = cross(sub(c, a), sub(b, a));
        let area = 0.5 * length(w);
        normal = add(normal, scale(unit_or_itself(w), area));
        surface += area;
        let [p, q, r] = local.map(|v| uv[v as usize].unwrap_or([f64::MAX; 2]));
        let signed = 0.5 * (perp(p, q) + perp(q, r) + perp(r, p));
        let flat = 0.5 * double_area(p, q, r).abs();
        laid += flat;
        for corner in [p, q, r] {
            for k in 0..2 {
                low[k] = least(low[k], corner[k]);
                high[k] = most(high[k], corner[k]);
            }
        }
        let mut distortion = most(area, flat) / least(area, flat);
        distortion = least(distortion, CLAMP_DISTORTION);
        if signed > 0.0 {
            distortion = CLAMP_DISTORTION;
        }
        sum += area * distortion * distortion;
    }
    let ideal = (laid * SQUARE_CENTIMETRES).sqrt();
    let spans = [0, 1].map(|k| {
        if high[k] - low[k] >= 0.0 {
            high[k] - low[k]
        } else {
            0.0
        }
    });
    let real = spans[0] * spans[1] * SQUARE_CENTIMETRES;
    let (larger, smaller) = match ideal >= real {
        true => (ideal, real),
        false => (real, ideal),
    };
    Metrics {
        distortion: sum / surface,
        normal: unit_or_itself(normal),
        compactness: (larger / smaller).sqrt(),
    }
}
