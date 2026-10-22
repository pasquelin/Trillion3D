//! Charts, their orientation and the packer.
use super::layout::Layout;
use super::raster::Raster;
use super::search::{best_placement, covering, rebalance, search_scale, Starts};
use crate::hlod::flatten::sort::unstable_sort;

/// An island: its triangles' corners, bounds, area, and the placement the packer gives it.
#[derive(Clone)]
pub(super) struct Chart {
    pub(super) id: usize,
    pub(super) corners: Vec<[f64; 2]>,
    pub(super) min: [f64; 2],
    pub(super) max: [f64; 2],
    pub(super) area: f64,
    pub(super) scale: f64,
    pub(super) rotation: [[f64; 2]; 2],
    pub(super) shift: [f64; 2],
    pub(super) bias: [f64; 2],
}

/// The quarter turn of `orientation` 0, 2, 4 or 6 (odd ones would be flips): the rotation and the
/// shift that brings the rotated box back to the origin.
fn orient(chart: &mut Chart, orientation: usize) {
    chart.bias = [0.0, 0.0];
    let (min, max) = (chart.min, chart.max);
    (chart.rotation, chart.shift) = match orientation {
        0 => ([[1.0, 0.0], [0.0, 1.0]], [-min[0], -min[1]]),
        2 => ([[0.0, 1.0], [-1.0, 0.0]], [-max[0], -min[1]]),
        4 => ([[-1.0, 0.0], [0.0, -1.0]], [-max[0], -max[1]]),
        _ => ([[0.0, -1.0], [1.0, 0.0]], [-min[0], -max[1]]),
    };
}

/// `m · v`, `m`'s rows `(a b)`, `(c d)`.
fn turn(m: [[f64; 2]; 2], v: [f64; 2]) -> [f64; 2] {
    [
        m[0][0] * v[0] + m[0][1] * v[1],
        m[1][0] * v[0] + m[1][1] * v[1],
    ]
}

impl Chart {
    /// The texel offset of the chart's rotated, scaled origin: its shift, the half-texel centre
    /// and its placement.
    fn packing_bias(&self) -> [f64; 2] {
        let s = [self.shift[0] * self.scale, self.shift[1] * self.scale];
        let r = turn(self.rotation, s);
        [r[0] + 0.5 + self.bias[0], r[1] + 0.5 + self.bias[1]]
    }

    /// A corner's texel position.
    pub(super) fn place(&self, uv: [f64; 2]) -> [f64; 2] {
        let r = turn(self.rotation, [uv[0] * self.scale, uv[1] * self.scale]);
        let b = self.packing_bias();
        [r[0] + b[0], r[1] + b[1]]
    }
}

/// The packer's state: the square's side in texels and the islands' total area.
pub(super) struct Packer {
    pub(super) resolution: u32,
    pub(super) total_area: f64,
}

impl Packer {
    /// Every chart at `scale`, those longer than the square shrunk to it and the others grown to
    /// keep the total area, then sorted largest box first.
    fn scale_charts(&self, charts: &mut [Chart], scale: f64) {
        for chart in charts.iter_mut() {
            chart.scale = scale;
        }
        charts.sort_by_key(|c| c.id);
        let max_edge = self.resolution as f64 - 1.0;
        let total = (scale, self.total_area);
        rebalance(total, (charts.len(), 1.01), |uniform| {
            let mut maxed = 0usize;
            let mut scaled_area = 0.0;
            for chart in charts.iter_mut() {
                let size = [chart.max[0] - chart.min[0], chart.max[1] - chart.min[1]];
                let longest = size[0].max(size[1]) * chart.scale * uniform;
                if longest + 0.01 > max_edge {
                    chart.scale = max_edge / size[0].max(size[1]);
                    maxed += 1;
                } else {
                    chart.scale *= uniform;
                }
                scaled_area += chart.area * chart.scale * chart.scale;
            }
            (maxed, scaled_area)
        });
        let rect = |c: &Chart| {
            let (w, h) = (
                (c.max[0] - c.min[0]) * c.scale,
                (c.max[1] - c.min[1]) * c.scale,
            );
            w * h
        };
        // Largest rect first by the one unstable sort the HLOD steps share: charts of equal rect
        // area stand as it leaves them.
        unstable_sort(charts, |a, b| rect(a) > rect(b));
    }

    /// The chart's triangles rasterized, dilated, into `raster` within `w × h`.
    fn rasterize(chart: &Chart, (w, h): (u32, u32), raster: &mut Raster) {
        let triangles = chart.corners.as_chunks::<3>().0.iter();
        raster.fill(
            triangles.map(|t| [0, 1, 2].map(|k| chart.place(t[k]).map(|x| x as f32))),
            (w, h),
        );
    }

    /// Whether every chart found a place at `scale`, and the efficiency.
    pub(super) fn pack(&self, charts: &mut [Chart], scale: f64) -> Option<f64> {
        self.scale_charts(charts, scale);
        let size = self.resolution;
        let mut layout = Layout::new(size);
        let mut raster = Raster::new(size);
        let mut starts = Starts::default();
        for chart in charts.iter_mut() {
            let prepare = |orientation: usize, raster: &mut Raster| {
                orient(chart, orientation);
                let extent = turn(
                    chart.rotation,
                    [
                        (chart.max[0] - chart.min[0]) * chart.scale,
                        (chart.max[1] - chart.min[1]) * chart.scale,
                    ],
                );
                let rect = covering(extent.map(|x| x as f32), size);
                Self::rasterize(chart, (rect.w, rect.h), raster);
                rect
            };
            let placed = best_placement((&layout, &mut raster), &mut starts, [0, 2, 4, 6], prepare);
            let (orientation, rect, chosen) = placed?;
            orient(chart, orientation);
            layout.alloc(&rect, &chosen);
            chart.bias[0] += rect.x as f64;
            chart.bias[1] += rect.y as f64;
        }
        Some(layout.used() as f64 / (size as f64 * size as f64))
    }

    /// The charts as last placed at the largest scale that fit (`search_scale`).
    pub(super) fn find_best(&self, charts: &mut Vec<Chart>) {
        let total = (self.resolution as f64, self.total_area);
        search_scale(total, charts, |charts, scale| self.pack(charts, scale));
    }
}
