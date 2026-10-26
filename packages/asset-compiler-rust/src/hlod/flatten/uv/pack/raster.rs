//! The raster and the rasterisation of a triangle.
use super::{Run, Segment};
use crate::support::digest::digest_words;

/// The texels a chart's raster uses, all the layout reads of it: its size and the runs of each
/// row and column, the rows and the columns by longest run first. Kept apart from the raster's
/// bits, so the one a chart is placed by is copied without them.
#[derive(Clone, Default)]
pub(crate) struct Footprint {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(super) rows: Vec<Run>,
    pub(super) columns: Vec<Run>,
    pub(super) sorted_rows: Vec<u32>,
    pub(super) sorted_columns: Vec<u32>,
}

impl Footprint {
    /// What identifies the raster, 128 bits of the digest of its rows' segments — each row's count
    /// of segments, then its segments' starts and lengths, row after row —: two rasters laid alike
    /// have one, and the key a map keeps is sixteen bytes whatever the raster's size.
    pub(crate) fn digest(&self) -> u128 {
        digest_words(self.rows.iter().flat_map(|row| {
            let count = std::iter::once(row.segments.len() as u32);
            count.chain(row.segments.iter().flat_map(|s| [s.start, s.length]))
        }))
    }
}

/// A chart's raster: its bits and the runs of texels it uses.
pub(crate) struct Raster {
    pub(super) size: u32,
    pub(super) bits: Vec<bool>,
    pub(crate) used: Footprint,
}

impl Raster {
    pub(crate) fn new(size: u32) -> Self {
        Raster {
            size,
            bits: vec![false; (size * size) as usize],
            used: Footprint::default(),
        }
    }

    pub(crate) fn clear(&mut self) {
        for y in 0..self.used.height {
            for x in 0..self.size {
                self.bits[(y * self.size + x) as usize] = false;
            }
        }
        self.used.width = 0;
        self.used.height = 0;
    }

    pub(super) fn get(&self, x: u32, y: u32) -> bool {
        self.bits[(y * self.size + x) as usize]
    }

    fn set(&mut self, x: u32, y: u32) {
        self.bits[(y * self.size + x) as usize] = true;
        self.used.height = self.used.height.max(y + 1);
        self.used.width = self.used.width.max(x + 1);
    }

    /// The raster cleared and `triangles` rasterized into it, dilated, within `width × height`
    /// texels, its segments made.
    pub(crate) fn fill(
        &mut self,
        triangles: impl IntoIterator<Item = [[f32; 2]; 3]>,
        (width, height): (u32, u32),
    ) {
        self.clear();
        for points in triangles {
            rasterize_triangle(self, points, width, height);
        }
        self.create_used_segments();
    }

    /// The raster turned about its vertical middle, within the columns it uses, its segments made
    /// again from the bits, as a flip changes every run: each row's bits in the reverse order. A
    /// raster of no texel is left as it is.
    pub(crate) fn flip_x(&mut self) {
        let (width, height) = (self.used.width as usize, self.used.height);
        for y in 0..height {
            let row = (y * self.size) as usize;
            self.bits[row..row + width].reverse();
        }
        self.create_used_segments();
    }

    /// The raster turned about its horizontal middle, within the rows it uses, its segments made
    /// again from the bits: the first row exchanged with the last, and so on inward.
    pub(crate) fn flip_y(&mut self) {
        let (width, height) = (self.used.width, self.used.height);
        for low in 0..height / 2 {
            let high = height - 1 - low;
            for x in 0..width {
                let (a, b) = (
                    (low * self.size + x) as usize,
                    (high * self.size + x) as usize,
                );
                self.bits.swap(a, b);
            }
        }
        self.create_used_segments();
    }

    /// The used segments of each row and column of the raster, and the rows
    /// and columns sorted longest segment first.
    pub(crate) fn create_used_segments(&mut self) {
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
        let (width, height) = (self.used.width, self.used.height);
        self.used.rows = runs(height, self.size, &|y, x| self.get(x, y));
        self.used.columns = runs(width, height, &|x, y| self.get(x, y));
        let used = &mut self.used;
        used.sorted_rows = (0..height).collect();
        used.sorted_rows.sort_by(|&a, &b| {
            used.rows[b as usize]
                .longest
                .cmp(&used.rows[a as usize].longest)
        });
        used.sorted_columns = (0..width).collect();
        used.sorted_columns.sort_by(|&a, &b| {
            (used.columns[b as usize].longest).cmp(&used.columns[a as usize].longest)
        });
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A raster of the texels `at`, its segments made.
    fn raster_of(at: &[(u32, u32)]) -> Raster {
        let mut raster = Raster::new(8);
        for &(x, y) in at {
            raster.set(x, y);
        }
        raster.create_used_segments();
        raster
    }

    #[test]
    fn a_flip_turns_the_raster_within_the_texels_it_uses() {
        let mut raster = raster_of(&[(0, 0), (2, 0), (0, 1)]);
        raster.flip_x();
        assert!(raster.get(2, 0) && raster.get(0, 0) && !raster.get(1, 0));
        assert!(raster.get(2, 1) && !raster.get(0, 1));
        raster.flip_y();
        assert!(raster.get(2, 0) && !raster.get(0, 0));
        assert!(raster.get(0, 1) && raster.get(2, 1));
        // The segments are made again from the bits.
        assert_eq!(raster.used.rows[0].segments.len(), 1);
        assert_eq!(raster.used.rows[1].segments.len(), 2);
    }

    #[test]
    fn rasters_laid_alike_have_one_digest_and_rasters_unlike_have_two() {
        let a = raster_of(&[(0, 0), (1, 0), (0, 1)]);
        let alike = raster_of(&[(0, 0), (1, 0), (0, 1)]);
        let unlike = raster_of(&[(0, 0), (2, 0), (0, 1)]);
        assert_eq!(a.used.digest(), alike.used.digest());
        assert_ne!(a.used.digest(), unlike.used.digest());
    }
}
