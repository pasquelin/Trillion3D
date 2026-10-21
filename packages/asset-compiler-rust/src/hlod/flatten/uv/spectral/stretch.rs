//! The stretch of a chart's parameterisation, measured and lowered.
//!
//! A face's stretch (`face`) compares its plane triangle to its surface triangle: the geometric
//! mean squared stretch (the mean of the squared singular values of the map, times the surface
//! area), the largest singular value scaled to the chart's area ratio (or its inverse when the
//! smaller one, inverted, is larger), and with a signal the mean of the signal tensor carried into
//! the plane. A folded or vanishing plane triangle has infinite stretch.
//!
//! The optimisation (`optimize`, `passes`, `vertex`, `walk`) moves one vertex at a time, taken
//! from a heap by the stretch of its faces, inside a circle that keeps it within its ring (and,
//! on a boundary, away from every other boundary edge and vertex), tries a few positions drawn at
//! random around a centre, halves the segment toward each, and keeps the best when it lowers the
//! vertex's stretch. A chart is optimised for its largest stretch, then its mean squared stretch;
//! with a signal, for the signal stretch with a whole-chart affine map between two passes.
//!
//! The charts are then scaled against one another (`scale`) so the atlas spends its area where
//! the stretch asks for it. This file holds the measures over a list of charts.
use super::mesh::{Chart, NONE};
use super::util::{near_zero, root, ZERO};

mod face;
mod optimize;
mod passes;
mod scale;
mod vertex;
mod walk;

pub(crate) use scale::scale_charts_optimally;

/// The stretch of a degenerate face.
pub(crate) const INFINITE_STRETCH: f32 = f32::MAX;

/// Whether the mean squared stretch `current` is within `10·ZERO` of the bound `expected`.
pub(crate) fn reaches_expected(current: f32, expected: f32) -> bool {
    current - ZERO * 10.0 <= expected
}

/// Each chart of some area scaled to its surface area; the chart of largest mean squared stretch
/// per surface area, and that stretch.
pub(crate) fn widest_geometric_stretch(charts: &mut [Chart]) -> (u32, f32) {
    let mut largest = 0.0;
    let mut at = 0;
    for (i, chart) in charts.iter_mut().enumerate() {
        if near_zero(chart.area_2d) || near_zero(chart.area_3d) {
            continue;
        }
        chart.scale(root(chart.area_3d / chart.area_2d));
        if largest < chart.stretch_l2 / chart.area_3d {
            largest = chart.stretch_l2 / chart.area_3d;
            at = i as u32;
        }
    }
    (at, largest)
}

/// The chart to split next: the largest mean squared stretch among the charts of more than one
/// face that can still lower it, else the first chart of more than one face.
pub(crate) fn best_split_candidate(charts: &[Chart]) -> u32 {
    let mut at = NONE;
    let mut largest = -1.0;
    for (i, chart) in charts.iter().enumerate() {
        if chart.stretch_l2 == chart.base_l2 || chart.faces.len() == 1 {
            continue;
        }
        if largest < chart.stretch_l2 {
            largest = chart.stretch_l2;
            at = i as u32;
        }
    }
    if at == NONE {
        if let Some(i) = charts.iter().position(|c| c.faces.len() > 1) {
            at = i as u32;
        }
    }
    at
}

/// Every chart's mean squared stretch lowered.
pub(crate) fn optimize_all_l2(charts: &mut [Chart], signal: bool) {
    for chart in charts {
        chart.optimize_l2(signal);
    }
}

/// Every chart's geometric stretch recomputed.
pub(crate) fn recompute_geometric_l2(charts: &mut [Chart]) {
    for chart in charts {
        chart.geometric_l2 = chart.geometric_l2_sum();
    }
}

/// The atlas's mean squared stretch once each chart takes its optimal scale: the sum over charts
/// of `√(stretch · plane area)`, over the surface area, squared; 1 when every chart's stretch
/// equals its plane area, 0 without a chart.
pub(crate) fn optimal_l2_mean<'c, 'a: 'c>(charts: impl IntoIterator<Item = &'c Chart<'a>>) -> f32 {
    let mut area = None;
    let mut all_isometric = true;
    let mut sum = 0.0;
    for chart in charts {
        area = Some(chart.source.area);
        all_isometric = all_isometric && chart.stretch_l2 == chart.area_2d;
        sum += root(chart.stretch_l2 * chart.area_2d);
    }
    let Some(area) = area else {
        return 0.0;
    };
    if all_isometric {
        return 1.0;
    }
    (sum / area) * (sum / area)
}
