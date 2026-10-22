//! The charts scaled for one attempt at a packing: each chart's scale from its edges' lengths in
//! the mesh times the attempt's, every chart then kept within the square — one that would not fit
//! is shrunk to it and the others grown to keep the total area —, once for both axes together and
//! once for each axis apart, then the charts sorted largest box first.
use super::chart::{times, Chart};
use crate::hlod::flatten::sort::unstable_sort;
use crate::hlod::flatten::uv::pack::rebalance;
use trillion3d_math::vector::vecn::{scale, sub};

/// How much a chart's longest edge may exceed the square's before it is shrunk to it.
const EPSILON: f32 = 0.01;

/// The rebalancing stops below this ratio.
const MINOR: f32 = 1.01;

/// What a scaling is held to: the attempt's scale, the longest edge a chart may have, and the
/// charts' areas' total before scaling.
#[derive(Clone, Copy)]
struct Bounds {
    uv_scale: f32,
    largest: f32,
    total_area: f32,
}

/// The charts rescaled round by round (`rebalance`): `step` rescales a chart by the factor of the
/// round and tells how many of its `slots` — one a chart, or one an axis — now reach the square's
/// size.
fn fit(
    charts: &mut [Chart],
    (bounds, slots): (Bounds, usize),
    mut step: impl FnMut(&mut Chart, f32) -> usize,
) {
    let slots = slots * charts.len();
    let total = (bounds.uv_scale, bounds.total_area);
    rebalance(total, (slots, MINOR), |factor| {
        let mut maxed = 0;
        let mut scaled_area = 0.0f32;
        for chart in charts.iter_mut() {
            maxed += step(chart, factor);
            scaled_area += chart.uv_area * chart.uv_scale[0] * chart.uv_scale[1];
        }
        (maxed, scaled_area)
    });
}

/// `charts`' scales set from `uv_scale` (module doc), for a square `resolution` texels wide and
/// charts whose areas total `total_area` before scaling; the charts left sorted largest box first.
pub(super) fn scale_charts(charts: &mut [Chart], uv_scale: f32, resolution: u32, total_area: f32) {
    for chart in charts.iter_mut() {
        chart.uv_scale = [chart.world_scale * uv_scale; 2];
    }
    // Back to the order they were found in, whatever order an earlier attempt left them in.
    charts.sort_unstable_by_key(|c| c.id);
    let bounds = Bounds {
        uv_scale,
        largest: resolution as f32 - 1.0,
        total_area,
    };
    // Both axes together: a chart whose longest edge reaches the square's has both its scales set
    // to reach it exactly, the others scaled by one factor.
    fit(charts, (bounds, 1), |chart, factor| {
        let size = sub(chart.max, chart.min);
        let scaled = scale(times(size, chart.uv_scale), factor);
        if scaled[0].max(scaled[1]) + EPSILON > bounds.largest {
            let edge = bounds.largest / size[0].max(size[1]);
            chart.uv_scale = [edge, edge];
            1
        } else {
            chart.uv_scale = scale(chart.uv_scale, factor);
            0
        }
    });
    // Each axis on its own: an axis whose edge reaches the square's is set to reach it exactly.
    fit(charts, (bounds, 2), |chart, factor| {
        let mut maxed = 0;
        for k in 0..2 {
            let size = chart.max[k] - chart.min[k];
            if size * chart.uv_scale[k] * factor + EPSILON > bounds.largest {
                chart.uv_scale[k] = bounds.largest / size;
                maxed += 1;
            } else {
                chart.uv_scale[k] *= factor;
            }
        }
        maxed
    });
    let area = |c: &Chart| {
        let size = times(sub(c.max, c.min), c.uv_scale);
        size[0] * size[1]
    };
    unstable_sort(charts, |a, b| area(a) > area(b));
}
