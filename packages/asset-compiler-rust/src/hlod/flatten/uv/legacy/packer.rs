//! The charts packed into a square of texels: the scale searched for the largest at which they
//! all fit (`find_best`), each attempt placing the charts largest first (`pack_charts`), each in
//! its eight orientations, a quarter turn and a flip of each, at the place the raster packer
//! leaves least of the square's width and height used (`uv::pack`, which also holds the search
//! and the placement the islands' packer shares).
//!
//! The first attempt scales the charts so that they would cover half the square, and the scale is
//! halved while they do not fit; the scale is then bisected six times between the last that failed
//! and the last that fit, the search stopping early when a fit gains less than a percent of
//! efficiency on the one before. The charts of the last fit are the result.
use super::chart::Chart;
use super::finder::Found;
use super::scale::scale_charts;
use crate::hlod::flatten::uv::pack::{covering, place_charts, search_scale, Raster, Rect};
use trillion3d_math::vector::vecn::{add, scale, sub};

/// What every attempt reads: the coordinates and the triangles by chart, the square's side and
/// the charts' areas' total before scaling.
struct Attempt<'a> {
    uvs: &'a [[f32; 2]],
    sorted: &'a [u32],
    resolution: u32,
    total_area: f32,
}

/// The eight orientations: a quarter turn at a time, flipped on the first axis from the odd ones.
const ORIENTATIONS: [usize; 8] = [0, 1, 2, 3, 4, 5, 6, 7];

/// A chart's transform of the orientation `orientation` — the scales its coordinates take on the
/// first and the second axis of the square, and the offset that brings its box to the origin, a
/// half texel in — set.
fn orient(chart: &mut Chart, orientation: usize) {
    let [sx, sy] = chart.uv_scale;
    let (min, max) = (chart.min, chart.max);
    let (scale_u, scale_v, from) = match orientation {
        0 => ([sx, 0.0], [0.0, sy], (min[0], min[1])),
        1 => ([-sx, 0.0], [0.0, sy], (max[0], min[1])),
        2 => ([0.0, -sx], [sy, 0.0], (max[0], min[1])),
        3 => ([0.0, sx], [sy, 0.0], (min[0], min[1])),
        4 => ([-sx, 0.0], [0.0, -sy], (max[0], max[1])),
        5 => ([sx, 0.0], [0.0, -sy], (min[0], max[1])),
        6 => ([0.0, sx], [-sy, 0.0], (min[0], max[1])),
        _ => ([0.0, -sx], [-sy, 0.0], (max[0], max[1])),
    };
    chart.scale_u = scale_u;
    chart.scale_v = scale_v;
    // The bias: minus the first corner's first coordinate times the first scale, minus its second
    // times the second scale, and a half texel.
    chart.bias = [0, 1].map(|k| (-from.0 * scale_u[k] - from.1 * scale_v[k]) + 0.5f32);
}

/// Where `uv` lands under `chart`'s transform.
fn place(chart: &Chart, uv: [f32; 2]) -> [f32; 2] {
    let u = scale(chart.scale_u, uv[0]);
    let v = scale(chart.scale_v, uv[1]);
    add(add(u, v), chart.bias)
}

/// `chart`'s footprint in the orientation it is set to, filled into `raster`, and its rectangle at
/// the origin: the raster of an odd orientation is that of the one before, flipped.
fn footprint(chart: &Chart, orientation: usize, attempt: &Attempt, raster: &mut Raster) -> Rect {
    let extent = sub(chart.max, chart.min);
    let covered = add(
        scale(chart.scale_u, extent[0]),
        scale(chart.scale_v, extent[1]),
    );
    let rect = covering(covered, attempt.resolution);
    match orientation % 4 {
        1 => raster.flip_x(),
        3 => raster.flip_y(),
        _ => {
            let corner = |tri: u32, k: usize| place(chart, attempt.uvs[3 * tri as usize + k]);
            let triangles = attempt.sorted[chart.first..chart.last].iter();
            let points = triangles.map(|&tri| [0, 1, 2].map(|k| corner(tri, k)));
            raster.fill(points, (rect.w, rect.h));
        }
    }
    rect
}

/// One attempt at scale `uv_scale`: every chart scaled (`scale_charts`) and placed largest first,
/// the efficiency of the layout — the share of the square used — when they all fit.
fn pack_charts(
    charts: &mut [Chart],
    uv_scale: f32,
    attempt: &Attempt,
    raster: &mut Raster,
) -> Option<f32> {
    scale_charts(charts, uv_scale, attempt.resolution, attempt.total_area);
    let size = attempt.resolution;
    let prepare = |chart: &mut Chart, orientation: usize, raster: &mut Raster| {
        orient(chart, orientation);
        footprint(chart, orientation, attempt, raster)
    };
    let shift = |chart: &mut Chart, rect: &Rect| {
        chart.bias[0] += rect.x as f32;
        chart.bias[1] += rect.y as f32;
    };
    let used = place_charts(
        charts,
        (size, raster),
        &ORIENTATIONS,
        prepare,
        orient,
        shift,
    )?;
    Some(used as f32 / (size * size) as f32)
}

/// The charts of `found` packed into a square `resolution` texels wide (module doc), as the last
/// fit left them; none where they are more than the texels, or their areas are no number above
/// zero: a coordinate that is not a number, or lengths that overflow, gives charts that "fit" at
/// the origin whatever their size.
pub(super) fn find_best(found: &Found, resolution: u32) -> Option<Vec<Chart>> {
    let mut charts = found.charts.clone();
    if charts.len() as u64 > u64::from(resolution) * u64::from(resolution) {
        return None;
    }
    let mut total_area = 0.0f32;
    for chart in &charts {
        total_area += chart.uv_area * chart.world_scale * chart.world_scale;
    }
    if !(total_area > 0.0 && total_area.is_finite()) {
        return None;
    }
    let attempt = Attempt {
        uvs: &found.uvs,
        sorted: &found.sorted,
        resolution,
        total_area,
    };
    let mut raster = Raster::new(resolution);
    let pack = |charts: &mut [Chart], at: f32| pack_charts(charts, at, &attempt, &mut raster);
    search_scale((resolution as f32, total_area), &mut charts, pack);
    Some(charts)
}
