//! The ear cut of a projected ring, on links: taking an ear unlinks one corner, and an ear is
//! tested only against the corners that can lie in it, through a grid.
//!
//! Only a corner that does not turn strictly convex can fall in an ear of a simple polygon; an ear
//! taken only ever opens its two neighbours' angles, so that set only shrinks. A ring with none,
//! that swings round once, is convex: every ear is taken at once and the cut walks the fan in
//! linear time. A ring with none that swings round more crosses itself: every corner is then
//! tested, and a missing ear is forced and counted, as always.
use super::convex::swings_once;
use super::{cancel, Ngon};
use std::sync::atomic::AtomicBool;
use trillion3d_math::vec2::double_area;

/// The tested corners by grid cell (`starts`, `items`), over the box `low`…`low + side / scale`.
#[derive(Default)]
pub(super) struct Grid {
    side: usize,
    low: [f64; 2],
    scale: [f64; 2],
    starts: Vec<u32>,
    items: Vec<u32>,
}

impl Grid {
    fn cell(&self, p: [f64; 2]) -> [usize; 2] {
        let at = |axis: usize| {
            let x = (p[axis] - self.low[axis]) * self.scale[axis];
            (x.max(0.0) as usize).min(self.side - 1)
        };
        [at(0), at(1)]
    }

    /// Indexes the `tested` corners of `flat`, about one a cell.
    fn build(&mut self, flat: &[[f64; 2]], tested: &[bool]) {
        let points = || (0..flat.len()).filter(|&v| tested[v]).map(|v| (v, flat[v]));
        let count = points().count();
        self.side = ((count as f64).sqrt().ceil() as usize).max(1);
        let (mut low, mut high) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for (_, p) in points() {
            for axis in 0..2 {
                low[axis] = low[axis].min(p[axis]);
                high[axis] = high[axis].max(p[axis]);
            }
        }
        self.low = low;
        self.scale = [0, 1].map(|axis| match high[axis] - low[axis] {
            span if span > 0.0 && span.is_finite() => self.side as f64 / span,
            _ => 0.0,
        });
        let cells = self.side * self.side;
        self.starts.clear();
        self.starts.resize(cells + 1, 0);
        for (_, p) in points() {
            let [x, y] = self.cell(p);
            self.starts[y * self.side + x + 1] += 1;
        }
        for c in 0..cells {
            self.starts[c + 1] += self.starts[c];
        }
        self.items.clear();
        self.items.resize(count, 0);
        let mut fill = self.starts.clone();
        for (v, p) in points() {
            let [x, y] = self.cell(p);
            let slot = &mut fill[y * self.side + x];
            self.items[*slot as usize] = v as u32;
            *slot += 1;
        }
    }

    /// The indexed corners whose cell meets the box of `triangle`.
    fn under(&self, triangle: [[f64; 2]; 3]) -> impl Iterator<Item = usize> + '_ {
        let low = [0, 1].map(|a| triangle.iter().map(|p| p[a]).fold(f64::INFINITY, f64::min));
        let high = [0, 1].map(|a| {
            triangle
                .iter()
                .map(|p| p[a])
                .fold(f64::NEG_INFINITY, f64::max)
        });
        let ([x0, y0], [x1, y1]) = (self.cell(low), self.cell(high));
        // A row's cells are contiguous in `items`: one slice a row.
        (y0..=y1).flat_map(move |y| {
            let base = y * self.side;
            let (from, to) = (self.starts[base + x0], self.starts[base + x1 + 1]);
            self.items[from as usize..to as usize]
                .iter()
                .map(|&v| v as usize)
        })
    }
}

impl Ngon {
    /// Ear cut of the projected ring, walked in the sense `turn`: `Some(true)` when every
    /// triangle was an ear, `Some(false)` when one had to be forced, `None` when the token rose.
    pub(super) fn ears(&mut self, turn: f64, cancelled: &AtomicBool) -> Option<bool> {
        let n = self.flat.len();
        self.prev.clear();
        self.prev.extend((0..n).map(|v| (v + n - 1) % n));
        self.next.clear();
        self.next.extend((0..n).map(|v| (v + 1) % n));
        self.alive.clear();
        self.alive.resize(n, true);
        self.candidate.clear();
        self.candidate.extend((0..n).map(|v| !self.convex(v, turn)));
        if !self.candidate.contains(&true) && !swings_once(&self.flat) {
            self.candidate.fill(true);
        }
        self.grid.build(&self.flat, &self.candidate);
        let (mut exact, mut at, mut count) = (true, 1 % n, n);
        while count > 3 {
            let mut v = at;
            let found = (0..count).find_map(|_| {
                let ear = self.is_ear(v, turn).then_some(v);
                v = self.next[v];
                ear
            });
            let v = found.unwrap_or_else(|| self.widest(turn));
            exact &= found.is_some();
            let (before, after) = (self.prev[v], self.next[v]);
            self.triangles.push([before, v, after]);
            (self.next[before], self.prev[after]) = (after, before);
            (self.alive[v], self.candidate[v]) = (false, false);
            for neighbour in [before, after] {
                self.candidate[neighbour] &= !self.convex(neighbour, turn);
            }
            (at, count) = (after, count - 1);
            self.done += 1;
            if cancel::stopped(cancelled, self.done) {
                return None;
            }
        }
        let first = (0..n).find(|&v| self.alive[v]).unwrap_or_default();
        let second = self.next[first];
        self.triangles.push([first, second, self.next[second]]);
        Some(exact)
    }

    /// Does this living corner turn strictly convex between its living neighbours?
    fn convex(&self, v: usize, turn: f64) -> bool {
        let [a, b, c] = self.ear(v);
        turn * double_area(a, b, c) > 0.0
    }

    /// Triangle of a living corner and its two living neighbours, in the cut plane.
    fn ear(&self, v: usize) -> [[f64; 2]; 3] {
        [
            self.flat[self.prev[v]],
            self.flat[v],
            self.flat[self.next[v]],
        ]
    }

    /// Is this corner an ear? It must not turn into the polygon, and no tested corner must fall
    /// in its triangle, border included: a vertex sitting on the diagonal stays there after the
    /// cut, on the wrong side of the remaining edge. An aligned or duplicated corner passes: its
    /// triangle has zero area, contains nothing, and the cut always advances.
    fn is_ear(&self, v: usize, turn: f64) -> bool {
        let [a, b, c] = self.ear(v);
        let area = turn * double_area(a, b, c);
        if area < 0.0 {
            return false;
        }
        if area == 0.0 {
            return true;
        }
        let corners = [self.prev[v], v, self.next[v]];
        !self.grid.under([a, b, c]).any(|other| {
            self.candidate[other] && !corners.contains(&other) && {
                let point = self.flat[other];
                ![a, b, c].contains(&point)
                    && turn * double_area(a, b, point) >= 0.0
                    && turn * double_area(b, c, point) >= 0.0
                    && turn * double_area(c, a, point) >= 0.0
            }
        })
    }

    /// Most salient living corner, cut by force when no ear presents itself: a self-intersecting
    /// polygon has none, and the cut must finish. The first in ring order wins on a tie.
    fn widest(&self, turn: f64) -> usize {
        let saliency = |v: usize| {
            let [a, b, c] = self.ear(v);
            turn * double_area(a, b, c)
        };
        let mut living = (0..self.flat.len()).filter(|&v| self.alive[v]);
        let first = living.next().unwrap_or_default();
        living.fold(first, |best, v| {
            match saliency(v).total_cmp(&saliency(best)).is_gt() {
                true => v,
                false => best,
            }
        })
    }
}
