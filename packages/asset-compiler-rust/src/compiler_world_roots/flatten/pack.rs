//! The islands packed into the unit square by a raster packer: each island is rasterized into
//! texels and slid over the free texel runs of the square until it lands on none in use. The
//! islands keep their relative scale and are never mirrored — a flip would turn the baked
//! texture's handedness — but may turn by quarter turns, which costs nothing:
//!
//! - `find_best`: the scale searched linearly by halves from where the islands would fill half the
//!   square, then by six bisections, stopping within a percent of efficiency;
//! - `scale_charts`: every island at the scale, those too long for the square shrunk to it and the
//!   others grown to keep the total area, then sorted largest box first;
//! - `pack`: each island tried in its four rotations, rasterized with a one-pixel dilation so
//!   neighbours never share a texel (`rasterize`, `rasterize_triangle`), placed by the segment
//!   search (`Layout::find`) where its right plus its top is least, keeping the square's corner
//!   filled first.
use trillion3d_math::aabb::aabb_of;
use trillion3d_math::vec2::double_area;
use trillion3d_page_codec::hash::WordMap;

/// A segment of a run: its start and length.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Segment {
    start: u32,
    length: u32,
}

/// A row's or a column's segments, the longest, and in free mode the lookup from a
/// position to the first free segment of the search.
#[derive(Clone, Default)]
struct Run {
    longest: u32,
    segments: Vec<Segment>,
    lookup: Vec<u16>,
}

/// A chart's placement in the square, in texels.
#[derive(Clone, Copy)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

/// A chart's raster: its bits and the runs of texels it uses.
#[derive(Clone)]
struct Raster {
    size: u32,
    bits: Vec<bool>,
    width: u32,
    height: u32,
    rows: Vec<Run>,
    columns: Vec<Run>,
    sorted_rows: Vec<u32>,
    sorted_columns: Vec<u32>,
}

impl Raster {
    fn new(size: u32) -> Self {
        Raster {
            size,
            bits: vec![false; (size * size) as usize],
            width: 0,
            height: 0,
            rows: Vec::new(),
            columns: Vec::new(),
            sorted_rows: Vec::new(),
            sorted_columns: Vec::new(),
        }
    }

    fn clear(&mut self) {
        for y in 0..self.height {
            for x in 0..self.size {
                self.bits[(y * self.size + x) as usize] = false;
            }
        }
        self.width = 0;
        self.height = 0;
    }

    fn get(&self, x: u32, y: u32) -> bool {
        self.bits[(y * self.size + x) as usize]
    }

    fn set(&mut self, x: u32, y: u32) {
        self.bits[(y * self.size + x) as usize] = true;
        self.height = self.height.max(y + 1);
        self.width = self.width.max(x + 1);
    }

    /// The used segments of each row and column of the raster, and the rows
    /// and columns sorted longest segment first.
    fn create_used_segments(&mut self) {
        let runs = |count: u32, length: u32, at: &dyn Fn(u32, u32) -> bool| -> Vec<Run> {
            (0..count)
                .map(|i| {
                    let mut run = Run::default();
                    let mut first: Option<u32> = None;
                    for j in 0..length {
                        if at(i, j) {
                            first.get_or_insert(j);
                        } else if let Some(s) = first.take() {
                            run.segments.push(Segment {
                                start: s,
                                length: j - s,
                            });
                        }
                    }
                    if let Some(s) = first {
                        run.segments.push(Segment {
                            start: s,
                            length: length - s,
                        });
                    }
                    run.longest = run.segments.iter().map(|s| s.length).max().unwrap_or(0);
                    run
                })
                .collect()
        };
        self.rows = runs(self.height, self.size, &|y, x| self.get(x, y));
        self.columns = runs(self.width, self.height, &|x, y| self.get(x, y));
        self.sorted_rows = (0..self.height).collect();
        self.sorted_rows.sort_by(|&a, &b| {
            self.rows[b as usize]
                .longest
                .cmp(&self.rows[a as usize].longest)
        });
        self.sorted_columns = (0..self.width).collect();
        self.sorted_columns.sort_by(|&a, &b| {
            (self.columns[b as usize].longest).cmp(&self.columns[a as usize].longest)
        });
    }
}

/// The square being filled: the free runs of each row and column.
struct Layout {
    size: u32,
    rows: Vec<Run>,
    columns: Vec<Run>,
}

impl Layout {
    fn new(size: u32) -> Self {
        let free = Run {
            longest: size,
            segments: vec![Segment {
                start: 0,
                length: size,
            }],
            lookup: Vec::new(),
        };
        Layout {
            size,
            rows: vec![free.clone(); size as usize],
            columns: vec![free; size as usize],
        }
    }

    /// Whether `other`'s used segments, shifted by `offset`, all fall in `this`'s free ones; if
    /// not, `failed` is how far the search can skip before the run could fit.
    fn test_one_run(
        this: &Run,
        other: &Run,
        (offset, length, resolution): (u32, u32, u32),
        failed: &mut u32,
    ) -> bool {
        if this.longest < other.longest {
            *failed = resolution;
            return false;
        }
        let lookup = this.segments.len() > 16;
        for used in &other.segments {
            if used.start >= length {
                break;
            }
            let start = offset + used.start;
            let end = offset + (used.start + used.length).min(length);
            let mut free = if lookup {
                this.lookup[start as usize] as usize
            } else {
                0
            };
            let mut found = false;
            while free < this.segments.len() && start >= this.segments[free].start {
                if end <= this.segments[free].start + this.segments[free].length {
                    found = true;
                    break;
                }
                free += 1;
            }
            if !found {
                while free < this.segments.len() {
                    if used.length <= this.segments[free].length {
                        *failed = this.segments[free].start.wrapping_sub(start);
                        return false;
                    }
                    free += 1;
                }
                *failed = resolution;
                return false;
            }
        }
        true
    }

    fn test_all_rows(&self, rect: &Rect, other: &Raster, failed: &mut u32) -> bool {
        (other.sorted_rows.iter()).all(|&y| {
            let (this, run) = (&self.rows[(rect.y + y) as usize], &other.rows[y as usize]);
            Self::test_one_run(this, run, (rect.x, rect.w, self.size), failed)
        })
    }

    fn test_all_columns(&self, rect: &Rect, other: &Raster, failed: &mut u32) -> bool {
        (other.sorted_columns.iter()).all(|&x| {
            let (this, run) = (
                &self.columns[(rect.x + x) as usize],
                &other.columns[x as usize],
            );
            Self::test_one_run(this, run, (rect.y, rect.h, self.size), failed)
        })
    }

    /// The first place from `rect`'s, row after row — column after column for
    /// a chart taller than wide —, where `other` fits; `false` once `rect` cannot beat the best.
    fn find(&self, rect: &mut Rect, other: &Raster, best: &dyn Fn(&Rect) -> bool) -> bool {
        let mut test = *rect;
        let (max_width, max_height) = (self.size - test.w, self.size - test.h);
        if test.h > test.w {
            while test.x <= max_width {
                let mut failed = 1u32;
                test.y = 0;
                while test.y <= max_height {
                    if !best(rect) {
                        return false;
                    }
                    if self.test_all_columns(&test, other, &mut failed) {
                        *rect = test;
                        return true;
                    }
                    test.y = test.y.saturating_add(failed);
                }
                test.x += 1;
            }
        } else {
            while test.y <= max_height {
                let mut failed = 1u32;
                test.x = 0;
                while test.x <= max_width {
                    if !best(rect) {
                        return false;
                    }
                    if self.test_all_rows(&test, other, &mut failed) {
                        *rect = test;
                        return true;
                    }
                    test.x = test.x.saturating_add(failed);
                }
                test.y += 1;
            }
        }
        false
    }

    /// `other`'s used segments cut out of `this`'s free ones, then the lookup rebuilt.
    fn merge_run(this: &mut Run, other: &Run, (offset, length, perpendicular): (u32, u32, u32)) {
        for used in &other.segments {
            let start = offset + used.start;
            if let Some(index) =
                (this.segments.iter()).position(|f| start >= f.start && start < f.start + f.length)
            {
                let free = this.segments[index];
                if free.length == 1 {
                    this.segments.swap_remove(index);
                    continue;
                }
                let first = Segment {
                    start: free.start,
                    length: start - free.start,
                };
                let end = offset + (used.start + used.length).min(length) - 1;
                let second = Segment {
                    start: end + 1,
                    length: (free.start + free.length).wrapping_sub(end + 1),
                };
                this.segments.swap_remove(index);
                if first.length > 0 {
                    this.segments.push(first);
                }
                if second.length > 0 && second.length <= free.length {
                    this.segments.push(second);
                }
            }
        }
        this.segments.sort();
        this.lookup = vec![0; perpendicular as usize];
        this.longest = 0;
        let mut last = 0u32;
        for (index, segment) in this.segments.iter().enumerate() {
            this.longest = this.longest.max(segment.length);
            let stop = segment.start + segment.length;
            for at in last..stop {
                this.lookup[at as usize] = index as u16;
            }
            last = stop;
        }
        for at in last..perpendicular {
            this.lookup[at as usize] = this.segments.len() as u16;
        }
    }

    /// `other` placed at `rect`: its used segments cut out of every row and column it covers.
    fn alloc(&mut self, rect: &Rect, other: &Raster) {
        for y in 0..other.height {
            let run = &other.rows[y as usize];
            Self::merge_run(
                &mut self.rows[(rect.y + y) as usize],
                run,
                (rect.x, rect.w, self.size),
            );
        }
        for x in 0..other.width {
            let run = &other.columns[x as usize];
            Self::merge_run(
                &mut self.columns[(rect.x + x) as usize],
                run,
                (rect.y, rect.h, self.size),
            );
        }
    }

    /// The texels in use.
    fn used(&self) -> u32 {
        let free: u32 = (self.rows.iter())
            .flat_map(|r| r.segments.iter().map(|s| s.length))
            .sum();
        self.size * self.size - free
    }
}

/// The triangle in 28.4 fixed point, dilated by a pixel, its
/// covered pixels set within `width × height`.
fn rasterize_triangle(raster: &mut Raster, points: [[f32; 2]; 3], width: u32, height: u32) {
    const DILATE: i64 = 16;
    let half = 0.5f32;
    let mut p = points.map(|q| [q[0] - half, q[1] - half]);
    let facing =
        (p[0][0] - p[1][0]) * (p[2][1] - p[0][1]) - (p[0][1] - p[1][1]) * (p[2][0] - p[0][0]);
    if facing < 0.0 {
        p.swap(0, 2);
    }
    let fixed = |v: f32| (16.0f32 * v + 0.5) as i32 as i64;
    let (x0, x1, x2) = (fixed(p[0][0]), fixed(p[1][0]), fixed(p[2][0]));
    let (y0, y1, y2) = (fixed(p[0][1]), fixed(p[1][1]), fixed(p[2][1]));
    // C's integer division, toward zero.
    let bound = |a: i64| (a + 15) / 16;
    let min_x = bound(x0.min(x1).min(x2) - DILATE).clamp(0, width as i64);
    let max_x = bound(x0.max(x1).max(x2) + DILATE).clamp(0, width as i64);
    let min_y = bound(y0.min(y1).min(y2) - DILATE).clamp(0, height as i64);
    let max_y = bound(y0.max(y1).max(y2) + DILATE).clamp(0, height as i64);
    let (dx01, dx12, dx20) = (x0 - x1, x1 - x2, x2 - x0);
    let (dy01, dy12, dy20) = (y0 - y1, y1 - y2, y2 - y0);
    let mut c0 = dy01 * x0 - dx01 * y0;
    let mut c1 = dy12 * x1 - dx12 * y1;
    let mut c2 = dy20 * x2 - dx20 * y2;
    let fill = |dy: i64, dx: i64| if dy < 0 || (dy == 0 && dx > 0) { 0 } else { -1 };
    c0 += fill(dy01, dx01);
    c1 += fill(dy12, dx12);
    c2 += fill(dy20, dx20);
    c0 += (dx01.abs() + dy01.abs()) * DILATE;
    c1 += (dx12.abs() + dy12.abs()) * DILATE;
    c2 += (dx20.abs() + dy20.abs()) * DILATE;
    for y in min_y..max_y {
        for x in min_x..max_x {
            let inside = (c0 + (dx01 * y - dy01 * x) * 16)
                | (c1 + (dx12 * y - dy12 * x) * 16)
                | (c2 + (dx20 * y - dy20 * x) * 16);
            if inside >= 0 {
                raster.set(x as u32, y as u32);
            }
        }
    }
}

/// An island: its triangles' corners, bounds, area, and the placement the packer gives it.
#[derive(Clone)]
struct Chart {
    id: usize,
    corners: Vec<[f64; 2]>,
    min: [f64; 2],
    max: [f64; 2],
    area: f64,
    scale: f64,
    rotation: [[f64; 2]; 2],
    shift: [f64; 2],
    bias: [f64; 2],
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
    fn place(&self, uv: [f64; 2]) -> [f64; 2] {
        let r = turn(self.rotation, [uv[0] * self.scale, uv[1] * self.scale]);
        let b = self.packing_bias();
        [r[0] + b[0], r[1] + b[1]]
    }
}

/// The packer's state: the square's side in texels and the islands' total area.
struct Packer {
    resolution: u32,
    total_area: f64,
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
        charts.sort_by(|a, b| rect(b).total_cmp(&rect(a)));
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
    fn pack(&self, charts: &mut [Chart], scale: f64) -> Option<f64> {
        self.scale_charts(charts, scale);
        let size = self.resolution;
        let mut layout = Layout::new(size);
        let mut raster = Raster::new(size);
        // Each raster seen, by its rows' segments flattened — a row's count, then its starts and
        // lengths —, and where it last found a place.
        let mut best_start: WordMap<Vec<u32>, (u32, u32)> = WordMap::default();
        let mut key: Vec<u32> = Vec::new();
        for chart in charts.iter_mut() {
            let mut best: Option<(usize, Rect, Raster)> = None;
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
                    w: raster.width,
                    h: raster.height,
                    ..rect
                };
                let found = if placed.w == 0 && placed.h == 0 {
                    rect.x = 0;
                    rect.y = 0;
                    true
                } else {
                    key.clear();
                    for row in &raster.rows {
                        key.push(row.segments.len() as u32);
                        key.extend(row.segments.iter().flat_map(|s| [s.start, s.length]));
                    }
                    if let Some(&(x, y)) = best_start.get(key.as_slice()) {
                        placed.x = x;
                        placed.y = y;
                    }
                    let found = layout.find(&mut placed, &raster, &beats);
                    if found {
                        best_start.insert(key.clone(), (placed.x, placed.y));
                        rect.x = placed.x;
                        rect.y = placed.y;
                    }
                    found
                };
                if found && beats(&rect) {
                    let corner = rect.x == 0 && rect.y == 0;
                    best = Some((orientation, rect, raster.clone()));
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
    fn find_best(&self, charts: &mut Vec<Chart>) {
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

/// `corners`, per corner of the triangles, packed by `islands` into `[0, 1]²` for a `resolution`
/// texel square, the resolution held between 2 and 16384 and raised to the power of two whose
/// square holds a texel per chart (packing needs at least one texel per chart), so the packer
/// meets more charts than texels only past 16384² of them. `false`, the corners left as they are,
/// then or when the islands have no area.
pub(super) fn pack(corners: &mut [[f64; 2]], islands: &[Vec<usize>], resolution: u32) -> bool {
    let least = (islands.len() as f64).sqrt().ceil().max(1.0) as u32;
    let resolution = resolution.max(least.next_power_of_two()).clamp(2, 16384);
    let mut charts: Vec<Chart> = (islands.iter().enumerate())
        .map(|(id, island)| {
            let local: Vec<[f64; 2]> = (island.iter())
                .flat_map(|&t| corners[t * 3..t * 3 + 3].iter().copied())
                .collect();
            let (min, max) = aabb_of(local.iter().copied());
            let area = (local.as_chunks::<3>().0.iter())
                .map(|t| 0.5 * double_area(t[0], t[1], t[2]).abs())
                .sum();
            Chart {
                id,
                corners: local,
                min,
                max,
                area,
                scale: 0.0,
                rotation: [[1.0, 0.0], [0.0, 1.0]],
                shift: [0.0; 2],
                bias: [0.0; 2],
            }
        })
        .collect();
    let total_area: f64 = charts.iter().map(|c| c.area).sum();
    if charts.len() as u64 > resolution as u64 * resolution as u64 || total_area <= 0.0 {
        return false;
    }
    let packer = Packer {
        resolution,
        total_area,
    };
    packer.find_best(&mut charts);
    // Commit: each corner by its chart's rotation and scale, then its bias, over the resolution.
    let res = resolution as f64;
    for chart in &charts {
        let island = &islands[chart.id];
        for (k, &t) in island.iter().enumerate() {
            for c in 0..3 {
                let p = chart.place(chart.corners[k * 3 + c]);
                corners[t * 3 + c] = [p[0] / res, p[1] / res];
            }
        }
    }
    true
}
