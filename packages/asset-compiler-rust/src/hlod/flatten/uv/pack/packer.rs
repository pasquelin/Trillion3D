//! Charts, their orientation and the packer.
use super::layout::Layout;
use super::raster::{rasterize_triangle, Footprint, Raster};
use super::Rect;
use crate::hlod::flatten::sort::unstable_sort;
use trillion3d_page_codec::hash::WordMap;

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
        let mut uniform = 1.0f64;
        for _ in 0..1000 {
            let mut maxed = 0usize;
            let mut scaled_area = 0.0;
            for chart in charts.iter_mut() {
                let size = [chart.max[0] - chart.min[0], chart.max[1] - chart.min[1]];
                let longest = size[0].max(size[1]) * chart.scale * uniform;
                let max_edge = self.resolution as f64 - 1.0;
                if longest + 0.01 > max_edge {
                    chart.scale = max_edge / size[0].max(size[1]);
                    maxed += 1;
                } else {
                    chart.scale *= uniform;
                }
                scaled_area += chart.area * chart.scale * chart.scale;
            }
            if maxed == 0 || maxed == charts.len() {
                break;
            }
            let rebalance = scale * (self.total_area / scaled_area).sqrt();
            if rebalance < 1.01 {
                break;
            }
            uniform = rebalance;
        }
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
    fn rasterize(chart: &Chart, w: u32, h: u32, raster: &mut Raster) {
        raster.clear();
        for t in chart.corners.as_chunks::<3>().0 {
            let points = [0, 1, 2].map(|k| chart.place(t[k]).map(|x| x as f32));
            rasterize_triangle(raster, points, w, h);
        }
        raster.create_used_segments();
    }

    /// Whether every chart found a place at `scale`, and the efficiency.
    pub(super) fn pack(&self, charts: &mut [Chart], scale: f64) -> Option<f64> {
        self.scale_charts(charts, scale);
        let size = self.resolution;
        let mut layout = Layout::new(size);
        let mut raster = Raster::new(size);
        // Each raster seen, by its rows' segments flattened — a row's count, then its starts and
        // lengths —, and where it last found a place.
        let mut best_start: WordMap<Vec<u32>, (u32, u32)> = WordMap::default();
        let mut key: Vec<u32> = Vec::new();
        for chart in charts.iter_mut() {
            let mut best: Option<(usize, Rect, Footprint)> = None;
            let none = Rect {
                x: u32::MAX,
                y: u32::MAX,
                w: u32::MAX,
                h: u32::MAX,
            };
            for orientation in [0, 2, 4, 6] {
                orient(chart, orientation);
                let extent = turn(
                    chart.rotation,
                    [
                        (chart.max[0] - chart.min[0]) * chart.scale,
                        (chart.max[1] - chart.min[1]) * chart.scale,
                    ],
                );
                let mut rect = Rect {
                    x: 0,
                    y: 0,
                    w: ((extent[0].abs() as f32 + 1.0).ceil() as u32).min(size),
                    h: ((extent[1].abs() as f32 + 1.0).ceil() as u32).min(size),
                };
                Self::rasterize(chart, rect.w, rect.h, &mut raster);
                let current = best.as_ref().map_or(none, |b| b.1);
                let beats = |r: &Rect| {
                    (r.x as u64 + r.w as u64) + (r.y as u64 + r.h as u64)
                        < (current.x as u64 + current.w as u64)
                            + (current.y as u64 + current.h as u64)
                };
                let mut placed = Rect {
                    w: raster.used.width,
                    h: raster.used.height,
                    ..rect
                };
                let found = if placed.w == 0 && placed.h == 0 {
                    rect.x = 0;
                    rect.y = 0;
                    true
                } else {
                    key.clear();
                    for row in &raster.used.rows {
                        key.push(row.segments.len() as u32);
                        key.extend(row.segments.iter().flat_map(|s| [s.start, s.length]));
                    }
                    if let Some(&(x, y)) = best_start.get(key.as_slice()) {
                        placed.x = x;
                        placed.y = y;
                    }
                    let found = layout.find(&mut placed, &raster.used, &beats);
                    if found {
                        best_start.insert(key.clone(), (placed.x, placed.y));
                        rect.x = placed.x;
                        rect.y = placed.y;
                    }
                    found
                };
                if found && beats(&rect) {
                    let corner = rect.x == 0 && rect.y == 0;
                    best = Some((orientation, rect, raster.used.clone()));
                    if corner {
                        break;
                    }
                }
            }
            let (orientation, rect, chosen) = best?;
            orient(chart, orientation);
            layout.alloc(&rect, &chosen);
            chart.bias[0] += rect.x as f64;
            chart.bias[1] += rect.y as f64;
        }
        Some(layout.used() as f64 / (size as f64 * size as f64))
    }

    /// The charts as last placed at the largest scale
    /// that fit. The linear search halves the scale until the charts fit, with no floor: at a
    /// small enough scale each chart is one texel, and there are no more charts than texels.
    pub(super) fn find_best(&self, charts: &mut Vec<Chart>) {
        let (start, step, steps) = (0.5, 0.5, 6);
        let res = self.resolution as f64;
        let mut fail = res * (1.0 / self.total_area).sqrt();
        let mut pass = res * (start / self.total_area).sqrt();
        let mut last: Vec<Chart>;
        let mut last_efficiency;
        loop {
            if let Some(efficiency) = self.pack(charts, pass) {
                last = charts.clone();
                last_efficiency = efficiency;
                break;
            }
            fail = pass;
            pass *= step;
        }
        for _ in 0..steps {
            let scale = 0.5 * (fail + pass);
            match self.pack(charts, scale) {
                Some(efficiency) => {
                    last = charts.clone();
                    let gain = 100.0 * (efficiency - last_efficiency).abs();
                    last_efficiency = efficiency;
                    if gain <= 1.0 {
                        break;
                    }
                    pass = scale;
                }
                None => fail = scale,
            }
        }
        *charts = last;
    }
}
