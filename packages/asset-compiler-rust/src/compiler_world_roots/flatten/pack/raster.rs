//! The raster and the rasterisation of a triangle.
use super::{Run, Segment};

/// A chart's raster: its bits and the runs of texels it uses.
#[derive(Clone)]
pub(super) struct Raster {
    pub(super) size: u32,
    pub(super) bits: Vec<bool>,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) rows: Vec<Run>,
    pub(super) columns: Vec<Run>,
    pub(super) sorted_rows: Vec<u32>,
    pub(super) sorted_columns: Vec<u32>,
}

impl Raster {
    pub(super) fn new(size: u32) -> Self {
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

    pub(super) fn clear(&mut self) {
        for y in 0..self.height {
            for x in 0..self.size {
                self.bits[(y * self.size + x) as usize] = false;
            }
        }
        self.width = 0;
        self.height = 0;
    }

    pub(super) fn get(&self, x: u32, y: u32) -> bool {
        self.bits[(y * self.size + x) as usize]
    }

    fn set(&mut self, x: u32, y: u32) {
        self.bits[(y * self.size + x) as usize] = true;
        self.height = self.height.max(y + 1);
        self.width = self.width.max(x + 1);
    }

    /// The used segments of each row and column of the raster, and the rows
    /// and columns sorted longest segment first.
    pub(super) fn create_used_segments(&mut self) {
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

/// The triangle in 28.4 fixed point, dilated by a pixel, its
/// covered pixels set within `width × height`.
pub(super) fn rasterize_triangle(
    raster: &mut Raster,
    points: [[f32; 2]; 3],
    width: u32,
    height: u32,
) {
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
