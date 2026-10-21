//! The packer's raster: bit images, and the triangle rasterizer that marks the texels a chart
//! covers.
//!
//! `Bits` stores a row in 64-bit words, the texel `x` in bit `x mod 64` of word `x / 64`. A mark
//! is placed by that word arithmetic alone, so a texel past a row's width lands in the row's
//! padding bits or the next row, as the rasterizer's whole blocks may reach (only marks past the
//! whole image are dropped).
//!
//! `cover_triangle` is Ignacio Castaño's rasterizer: the triangle turned to face forward, its
//! edges' unit inward normals, then 8×8 blocks over its box (clamped to the image) sampled at texel
//! centres — a block wholly outside an edge (by `√32`) skipped, one wholly inside every edge
//! marked whole, any other texel marked when its centre is `1/√2` inside every edge or, when it is
//! within `1/√2` of them, when the triangle clipped to the texel keeps some area.
use super::vector::{least, most, unit, Vec2};
use trillion3d_math::vector::vecn::sub;

#[derive(Default)]
pub(super) struct Bits {
    pub(super) width: u32,
    pub(super) height: u32,
    stride: u32,
    words: Vec<u64>,
}

impl Bits {
    pub(super) fn new(width: u32, height: u32) -> Bits {
        let mut bits = Bits::default();
        bits.clear_to(width, height);
        bits
    }

    /// Sized `width × height`, every texel clear.
    fn clear_to(&mut self, width: u32, height: u32) {
        self.stride = (width + 63) >> 6;
        self.words.clear();
        self.words.resize((self.stride * height) as usize, 0);
        self.width = width;
        self.height = height;
    }

    /// Sized `width × height`, the texels both sizes hold kept.
    pub(super) fn resize_keeping(&mut self, width: u32, height: u32) {
        let stride = (width + 63) >> 6;
        let mut words = vec![0u64; (stride * height) as usize];
        let rows = self.height.min(height) as usize;
        if stride == self.stride {
            let count = self.stride as usize * rows;
            words[..count].copy_from_slice(&self.words[..count]);
        } else if self.width > 0 && self.height > 0 {
            let run = stride.min(self.stride) as usize;
            for row in 0..rows {
                let (to, from) = (row * stride as usize, row * self.stride as usize);
                words[to..to + run].copy_from_slice(&self.words[from..from + run]);
            }
        }
        self.words = words;
        self.width = width;
        self.height = height;
        self.stride = stride;
    }

    #[inline]
    fn word(&self, x: u32, y: u32) -> usize {
        (x >> 6) as usize + y as usize * self.stride as usize
    }

    #[inline]
    pub(super) fn get(&self, x: u32, y: u32) -> bool {
        self.words[self.word(x, y)] & (1u64 << (x & 63)) != 0
    }

    #[inline]
    pub(super) fn set(&mut self, x: u32, y: u32) {
        let word = self.word(x, y);
        if let Some(bits) = self.words.get_mut(word) {
            *bits |= 1u64 << (x & 63);
        }
    }

    /// The marks of `image` placed at `(x, y)` added, those at or past `within` (inside this
    /// image) dropped: each image row's words masked and shifted onto this image's.
    pub(super) fn mark_from(&mut self, image: &Bits, (x, y): (u32, u32), within: [u32; 2]) {
        let columns = within[0].saturating_sub(x).min(image.width);
        let rows = within[1].saturating_sub(y).min(image.height);
        let shift = x & 63;
        for row in 0..rows {
            let (from, to) = (image.word(0, row), self.word(x, y + row));
            for k in 0..columns.div_ceil(64) as usize {
                let left = columns - k as u32 * 64;
                let mut word = image.words[from + k];
                if left < 64 {
                    word &= (1u64 << left) - 1;
                }
                self.words[to + k] |= word << shift;
                // The texels past this word's end, inside the row as `within` is.
                if shift != 0 && word >> (64 - shift) != 0 {
                    self.words[to + k + 1] |= word >> (64 - shift);
                }
            }
        }
    }

    /// Whether `image` placed at `(ox, oy)` marks no texel this image marks; what falls outside
    /// this image is free, and so is an image of no width (a chart of no finite extent).
    pub(super) fn fits_at(&self, image: &Bits, ox: u32, oy: u32) -> bool {
        if image.width == 0 {
            return true;
        }
        for y in 0..image.height {
            let this_y = y + oy;
            if this_y >= self.height {
                continue;
            }
            let mut x = 0u32;
            loop {
                let this_x = x + ox;
                if this_x >= self.width {
                    break;
                }
                let this_shift = this_x % 64;
                let this_block = self.words[self.word(this_x, this_y)] >> this_shift;
                let shift = x % 64;
                let block = image.words[image.word(x, y)] >> shift;
                if this_block & block != 0 {
                    return false;
                }
                x += 64 - this_shift.max(shift);
                if x >= image.width {
                    break;
                }
            }
        }
        true
    }
}

/// A convex polygon clipped plane by plane (the triangle against a texel), in two buffers that
/// take turns.
struct Clipped {
    buffers: [[Vec2; 16]; 2],
    count: usize,
    active: usize,
}

impl Clipped {
    fn new(a: Vec2, b: Vec2, c: Vec2) -> Clipped {
        let mut buffers = [[[0.0f32; 2]; 16]; 2];
        buffers[0][..3].copy_from_slice(&[a, b, c]);
        Clipped {
            buffers,
            count: 3,
            active: 0,
        }
    }

    /// The polygon cut by the line `axis = offset`, the side kept where `direction · (offset −
    /// axis) ≥ 0`.
    fn clip(&mut self, axis: usize, offset: f32, direction: f32) {
        let (from, to) = (self.active, self.active ^ 1);
        self.active = to;
        let n = self.count;
        self.buffers[from][n] = self.buffers[from][0];
        let mut d1 = offset - self.buffers[from][0][axis];
        let mut in1 = direction * d1 >= 0.0;
        let mut p = 0;
        // A convex polygon cut by four lines keeps at most seven corners; the bound only guards
        // corners of no finite position.
        let limit = self.buffers[to].len() - 1;
        for k in 0..n {
            let (here, next) = (self.buffers[from][k], self.buffers[from][k + 1]);
            let d2 = offset - next[axis];
            let in2 = direction * d2 >= 0.0;
            if in1 && p < limit {
                self.buffers[to][p] = here;
                p += 1;
            }
            if in1 != in2 && p < limit {
                let other = 1 - axis;
                let slope = (next[other] - here[other]) / (next[axis] - here[axis]);
                let mut cut = [0.0f32; 2];
                cut[axis] = offset;
                cut[other] = here[other] + d1 * slope;
                self.buffers[to][p] = cut;
                p += 1;
            }
            d1 = d2;
            in1 = in2;
        }
        self.count = p;
    }

    /// The polygon's area once clipped to `[x0, x1] × [y0, y1]`.
    fn area_in(mut self, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
        self.clip(0, x0, -1.0);
        self.clip(1, y0, -1.0);
        self.clip(0, x1, 1.0);
        self.clip(1, y1, 1.0);
        let n = self.count;
        let v = &mut self.buffers[self.active];
        v[n] = v[0];
        let mut area = 0.0f32;
        for k in 0..n {
            area += v[k][0] * v[k + 1][1] - v[k + 1][0] * v[k][1];
        }
        0.5 * area.abs()
    }
}

/// The unit inward normal of the edge `a → b` of a forward-facing triangle.
fn inward(a: Vec2, b: Vec2) -> Vec2 {
    let d = sub(a, b);
    unit([-d[1], d[0]])
}

/// Every texel of the `extents` image the triangle `v` covers, visited as `(x, y)`.
pub(super) fn cover_triangle(extents: Vec2, v: [Vec2; 3], mut visit: impl FnMut(i32, i32)) {
    let (mut v1, mut v2, v3) = (v[0], v[2], v[1]);
    if (v3[0] - v1[0]) * (v2[1] - v1[1]) - (v3[1] - v1[1]) * (v2[0] - v1[0]) < 0.0 {
        std::mem::swap(&mut v1, &mut v2);
    }
    let (e0, e1) = (sub(v3, v1), sub(v2, v1));
    if e0[1] * e1[0] - e1[1] * e0[0] == 0.0 {
        return;
    }
    let (n1, n2, n3) = (inward(v1, v2), inward(v2, v3), inward(v3, v1));
    let px_inside = 1.0f32 / 2.0f32.sqrt();
    let px_outside = -1.0f32 / 2.0f32.sqrt();
    const BLOCK: f32 = 8.0;
    let block_inside = (BLOCK * BLOCK / 2.0f32).sqrt();
    let block_outside = -(BLOCK * BLOCK / 2.0f32).sqrt();
    let low = |a: f32, b: f32, c: f32| least(a, least(b, c));
    let high = |a: f32, b: f32, c: f32| most(a, most(b, c));
    let min_x = most(low(v1[0], v2[0], v3[0]), 0.0).floor() + 0.5;
    let min_y = most(low(v1[1], v2[1], v3[1]), 0.0).floor() + 0.5;
    let max_x = least(high(v1[0], v2[0], v3[0]), extents[0] - 1.0).ceil() + 0.5;
    let max_y = least(high(v1[1], v2[1], v3[1]), extents[1] - 1.0).ceil() + 0.5;
    let c1 = n1[0] * (-v1[0]) + n1[1] * (-v1[1]);
    let c2 = n2[0] * (-v2[0]) + n2[1] * (-v2[1]);
    let c3 = n3[0] * (-v3[0]) + n3[1] * (-v3[1]);
    let mut y0 = min_y;
    while y0 <= max_y {
        let mut x0 = min_x;
        while x0 <= max_x {
            let (xc, yc) = (x0 + (BLOCK - 1.0) / 2.0, y0 + (BLOCK - 1.0) / 2.0);
            let a = c1 + n1[0] * xc + n1[1] * yc;
            let b = c2 + n2[0] * xc + n2[1] * yc;
            let c = c3 + n3[0] * xc + n3[1] * yc;
            if a <= block_outside || b <= block_outside || c <= block_outside {
                x0 += BLOCK;
                continue;
            }
            if a >= block_inside && b >= block_inside && c >= block_inside {
                let mut y = y0;
                while y < y0 + BLOCK {
                    let mut x = x0;
                    while x < x0 + BLOCK {
                        visit(x as i32, y as i32);
                        x += 1.0;
                    }
                    y += 1.0;
                }
            } else {
                let mut cy = [
                    c1 + n1[0] * x0 + n1[1] * y0,
                    c2 + n2[0] * x0 + n2[1] * y0,
                    c3 + n3[0] * x0 + n3[1] * y0,
                ];
                let mut y = y0;
                while y < y0 + BLOCK {
                    let mut cx = cy;
                    let mut x = x0;
                    while x < x0 + BLOCK {
                        if cx.iter().all(|&e| e >= px_inside) {
                            visit(x as i32, y as i32);
                        } else if cx.iter().all(|&e| e >= px_outside) {
                            let at = [x, y];
                            let clipped = Clipped::new(sub(v1, at), sub(v2, at), sub(v3, at));
                            if clipped.area_in(-0.5, -0.5, 0.5, 0.5) > 0.0 {
                                visit(x as i32, y as i32);
                            }
                        }
                        cx[0] += n1[0];
                        cx[1] += n2[0];
                        cx[2] += n3[0];
                        x += 1.0;
                    }
                    cy[0] += n1[1];
                    cy[1] += n2[1];
                    cy[2] += n3[1];
                    y += 1.0;
                }
            }
            x0 += BLOCK;
        }
        y0 += BLOCK;
    }
}
