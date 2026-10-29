//! Charts rasterised into texel grids, and the free space along a grid's sides.
//!
//! A chart in a turn: its texels cleared, each edge marks the texels it crosses (offset by the
//! gutter) — a short edge its one texel, an axis-aligned one the texel pairs along it, any other
//! the texel pairs at each grid line it crosses, stepping along its longer axis; the marked
//! texels then grow by one ring per gutter texel, each ring numbered one more than the last. A
//! chart that marks nothing and is wider than its gutters does not grow.
//!
//! A side's gap at a line: the empty texels from that side to the first filled one (a grown
//! texel counting as empty for a chart's own grid), one less when the line is empty.
use super::scale::to_int;
use super::{Packer, DOWN, LEFT, RIGHT, UP};

/// Texel `(y, x)` of `grid`, empty outside it.
pub(super) fn cell(grid: &[Vec<u8>], y: i32, x: i32) -> u8 {
    let row = usize::try_from(y).ok().and_then(|y| grid.get(y));
    row.and_then(|r| usize::try_from(x).ok().and_then(|x| r.get(x)))
        .copied()
        .unwrap_or(0)
}

/// Texel `(y, x)` of `grid` set to `value`, when inside it.
pub(super) fn set_cell(grid: &mut [Vec<u8>], y: i32, x: i32, value: u8) {
    let row = usize::try_from(y).ok().and_then(|y| grid.get_mut(y));
    if let Some(c) = row.and_then(|r| usize::try_from(x).ok().and_then(|x| r.get_mut(x))) {
        *c = value;
    }
}

/// Texel `(y, x)` of a chart grid marked, past its `gutter`.
fn mark(grid: &mut [Vec<u8>], gutter: i32, y: i32, x: i32) {
    set_cell(grid, y + gutter, x + gutter, 1);
}

/// Entry `i` of `line`, zero outside it.
pub(super) fn entry(line: &[i32], i: i32) -> i32 {
    usize::try_from(i)
        .ok()
        .and_then(|i| line.get(i))
        .copied()
        .unwrap_or(0)
}

/// Entry `i` of `line` changed by `change`, when inside it.
pub(super) fn update(line: &mut [i32], i: i32, change: impl Fn(i32) -> i32) {
    if let Some(e) = usize::try_from(i).ok().and_then(|i| line.get_mut(i)) {
        *e = change(*e);
    }
}

/// One past the first filled place from `from` toward `to`, `to` when none is.
fn first_filled(from: i32, to: i32, filled: impl Fn(i32) -> bool) -> i32 {
    let mut j = from;
    while j < to {
        j += 1;
        if filled(j - 1) {
            break;
        }
    }
    j
}

/// The last filled place from `to` back toward `from`, `from` when none is.
fn last_filled(from: i32, to: i32, filled: impl Fn(i32) -> bool) -> i32 {
    let mut j = to;
    while j > from {
        j -= 1;
        if filled(j) {
            break;
        }
    }
    j
}

/// The empty places before the first and after the last filled one of `from..to`.
fn gaps((from, to): (i32, i32), filled: impl Fn(i32) -> bool) -> (i32, i32) {
    let first = first_filled(from, to, &filled) - from - 1;
    let last = to - last_filled(from, to, &filled) - 1;
    (first, last)
}

/// The gaps of column `i` between rows `from` and `to`: from the top and from the bottom.
pub(super) fn column_gaps(
    grid: &[Vec<u8>],
    i: i32,
    rows: (i32, i32),
    filled: impl Fn(u8) -> bool,
) -> (i32, i32) {
    gaps(rows, |j| filled(cell(grid, j, i)))
}

/// The gaps of row `i` between columns `from` and `to`: from the left and from the right.
pub(super) fn row_gaps(
    grid: &[Vec<u8>],
    i: i32,
    columns: (i32, i32),
    filled: impl Fn(u8) -> bool,
) -> (i32, i32) {
    gaps(columns, |j| filled(cell(grid, i, j)))
}

/// Every side's gaps of `grid` over `from_x..to_x` × `from_y..to_y` into `space`; grown texels
/// count as empty when `ignore_grown`.
pub(super) fn fill_space(
    space: &mut [Vec<i32>; 4],
    grid: &[Vec<u8>],
    x: (i32, i32),
    y: (i32, i32),
    ignore_grown: bool,
) {
    let filled = |v: u8| if ignore_grown { v == 1 } else { v != 0 };
    for i in x.0..x.1 {
        let (up, down) = column_gaps(grid, i, y, filled);
        update(&mut space[UP], i, |_| up);
        update(&mut space[DOWN], i, |_| down);
    }
    for i in y.0..y.1 {
        let (left, right) = row_gaps(grid, i, x, filled);
        update(&mut space[LEFT], i, |_| left);
        update(&mut space[RIGHT], i, |_| right);
    }
}

/// The first `len` entries of `line` in reverse order.
pub(super) fn reverse(line: &mut [i32], len: i32) {
    let len = usize::try_from(len).unwrap_or(0).min(line.len());
    line[..len].reverse();
}

impl<'d> Packer<'d> {
    /// Chart `index` rasterised in turn `t` into the chart grid.
    pub(super) fn tessellate(&mut self, index: usize, t: usize) {
        let turn = &self.charts[index].turns[t];
        let (num_x, num_y) = (turn.num_x, turn.num_y);
        let min = [turn.low[0] - turn.adjust[0], turn.low[1] - turn.adjust[1]];
        for i in 0..num_y {
            for j in 0..num_x {
                set_cell(&mut self.chart_board, i, j, 0);
            }
        }
        let (g, pixel) = (self.gutter, self.pixel);
        let grid = &mut self.chart_board;
        let mut marked = 0;
        for e in &turn.edges {
            let from_x = to_int(((e.low[0] - min[0]) / pixel).floor());
            let to_x = to_int(((e.high[0] - min[0]) / pixel).ceil());
            let from_y = to_int(((e.low[1] - min[1]) / pixel).floor());
            let to_y = to_int(((e.high[1] - min[1]) / pixel).ceil());
            if to_x - from_x <= 1 && to_y - from_y <= 1 {
                mark(grid, g, from_y, from_x);
                marked += 1;
                continue;
            }
            if to_x - from_x <= 1 {
                let n = to_int(((e.p1[0] - min[0]) / pixel).floor());
                for m in from_y + 1..to_y {
                    mark(grid, g, m, n);
                    mark(grid, g, m - 1, n);
                    marked += 2;
                }
                continue;
            }
            if to_y - from_y <= 1 {
                let m = to_int(((e.p1[1] - min[1]) / pixel).floor());
                for n in from_x + 1..to_x {
                    mark(grid, g, m, n);
                    mark(grid, g, m, n - 1);
                    marked += 2;
                }
                continue;
            }
            let slope = (e.p2[1] - e.p1[1]) / (e.p2[0] - e.p1[0]);
            let b = e.p1[1] - e.p1[0] * slope;
            if slope.abs() < 1.0 {
                for n in from_x + 1..to_x {
                    let x = min[0] + n as f32 * pixel;
                    let y = slope * x + b;
                    let m = to_int(((y - min[1]) / pixel).floor());
                    mark(grid, g, m, n);
                    mark(grid, g, m, n - 1);
                    marked += 2;
                }
            } else {
                for m in from_y + 1..to_y {
                    let y = min[1] + m as f32 * pixel;
                    let x = (y - b) / slope;
                    let n = to_int(((x - min[0]) / pixel).floor());
                    mark(grid, g, m, n);
                    mark(grid, g, m - 1, n);
                    marked += 2;
                }
            }
        }
        if marked == 0 && num_x != 2 * g && num_y != 2 * g {
            return;
        }
        self.grow(num_x, num_y);
    }

    /// The marked texels of the chart grid's first `num_y` rows and `num_x` columns grown by one
    /// ring per gutter texel.
    fn grow(&mut self, num_x: i32, num_y: i32) {
        let grid = &mut self.chart_board;
        for i in 0..self.gutter {
            for m in 0..num_y.max(0) {
                for n in 0..num_x.max(0) {
                    if cell(grid, m, n) as i32 != i + 1 {
                        continue;
                    }
                    for j in -1..=1 {
                        for k in -1..=1 {
                            let (y, x) = (m + j, n + k);
                            let inside = y >= 0
                                && (y as usize) < grid.len()
                                && x >= 0
                                && (x as usize) < grid[y as usize].len();
                            if inside && grid[y as usize][x as usize] == 0 {
                                grid[y as usize][x as usize] = (i + 2) as u8;
                            }
                        }
                    }
                }
            }
        }
    }
}
