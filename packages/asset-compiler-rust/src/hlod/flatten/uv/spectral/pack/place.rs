//! A chart placed against the board.
//!
//! In each of its turns the chart is rasterised and its own side gaps read (grown texels empty);
//! the board grows sideways when it is taller than the atlas's aspect ratio, downward or upward
//! when wider, a random direction when equal. In that direction each of the chart's sides that
//! can face the board's side is slid along it (sides read backward for the half turns), and at
//! each offset the closest approach (the least sum of the two gaps, gutters excluded) and the
//! space wasted (the sums over the closest approach) are read. A placement is kept when the board's
//! new aspect ratio comes closer to the atlas's, or as close with less waste — or waste within 5%
//! and a deeper overlap. The best is kept across turns and charts until beaten. The chart's grid
//! in the best turn is copied, turned by the quarter turns chosen, onto the board's empty texels;
//! its transform is the turn then the move to its corner (`commit.rs`). A board grown past the
//! atlas aborts the layout.
use super::board::{cell, entry, fill_space, reverse, set_cell};
use super::scale::to_int;
use super::{Packer, Tried, DOWN, LEFT, RIGHT, TURNS, UP};

/// The waste of a fresh chart's search.
const FRESH_WASTE: i32 = 100_000_000;
/// The first ratio of a sideways search, and of an upward or downward one.
const SIDEWAYS_START: f32 = -1e10;
const VERTICAL_START: f32 = 1e10;

/// One slide: the chart's side facing the board, the board's side, the chart's quarter turns in
/// degrees, the chart's extent away from the board, and the chart side's length.
struct Slide {
    chart_side: usize,
    side: usize,
    rotation: i32,
    chart_width: i32,
    chart_len: i32,
}

impl<'d> Packer<'d> {
    /// Chart `index` placed where its best turn and slide put it.
    pub(super) fn put_chart(&mut self, index: usize) {
        if !self.charts[index].valid {
            return;
        }
        self.tried.internal_space = FRESH_WASTE;
        for i in 0..TURNS {
            self.tessellate(index, i);
            let (nx, ny) = (
                self.charts[index].turns[i].num_x,
                self.charts[index].turns[i].num_y,
            );
            fill_space(
                &mut self.chart_space,
                &self.chart_board,
                (0, nx),
                (0, ny),
                true,
            );
            self.current_turn = i;
            let side = if self.current_aspect > self.aspect {
                0
            } else if self.current_aspect < self.aspect {
                1
            } else {
                to_int((self.random() as f32 + 0.5).floor())
            };
            let slide = |chart_side, side, rotation, chart_width, chart_len| Slide {
                chart_side,
                side,
                rotation,
                chart_width,
                chart_len,
            };
            if side == 0 {
                if i == 0 {
                    self.tried.aspect = SIDEWAYS_START;
                }
                let along = (self.from[1], self.to[1]);
                self.try_put(slide(RIGHT, LEFT, 0, nx, ny), along);
                self.try_put(slide(UP, LEFT, 90, ny, nx), along);
                self.try_put(slide(LEFT, RIGHT, 0, nx, ny), along);
                self.try_put(slide(DOWN, RIGHT, 90, ny, nx), along);
                reverse(&mut self.chart_space[LEFT], ny);
                self.try_put(slide(LEFT, LEFT, 180, nx, ny), along);
                reverse(&mut self.chart_space[DOWN], nx);
                self.try_put(slide(DOWN, LEFT, 270, ny, nx), along);
                reverse(&mut self.chart_space[RIGHT], ny);
                self.try_put(slide(RIGHT, RIGHT, 180, nx, ny), along);
                reverse(&mut self.chart_space[UP], nx);
                self.try_put(slide(UP, RIGHT, 270, ny, nx), along);
            } else {
                if i == 0 {
                    self.tried.aspect = VERTICAL_START;
                }
                let along = (self.from[0], self.to[0]);
                self.try_put(slide(DOWN, UP, 0, ny, nx), along);
                self.try_put(slide(LEFT, UP, 270, nx, ny), along);
                self.try_put(slide(RIGHT, DOWN, 270, nx, ny), along);
                self.try_put(slide(UP, DOWN, 0, ny, nx), along);
                reverse(&mut self.chart_space[RIGHT], ny);
                self.try_put(slide(RIGHT, UP, 90, nx, ny), along);
                reverse(&mut self.chart_space[UP], nx);
                self.try_put(slide(UP, UP, 180, ny, nx), along);
                reverse(&mut self.chart_space[LEFT], ny);
                self.try_put(slide(LEFT, DOWN, 90, nx, ny), along);
                reverse(&mut self.chart_space[DOWN], nx);
                self.try_put(slide(DOWN, DOWN, 180, ny, nx), along);
            }
            if self.tried.turn == i {
                for y in 0..ny {
                    for x in 0..nx {
                        set_cell(&mut self.tried_board, y, x, cell(&self.chart_board, y, x));
                    }
                }
            }
        }
        self.put_in_position(index);
    }

    /// Every offset of `slide` along the board's side spanning `(from, to)` tried.
    fn try_put(&mut self, slide: Slide, (from, to): (i32, i32)) {
        if slide.chart_len > to - from {
            return;
        }
        let vertical = slide.side == UP || slide.side == DOWN;
        let width = if vertical {
            self.to[1] - self.from[1]
        } else {
            self.to[0] - self.from[0]
        };
        let (space, chart_space) = (&self.space[slide.side], &self.chart_space[slide.chart_side]);
        let span = (to - from) as f32;
        for i in from..to - slide.chart_len + 1 {
            let mut closest = FRESH_WASTE;
            let mut internal: i32 = 0;
            for j in self.gutter..slide.chart_len - self.gutter {
                let distance = entry(space, i + j).wrapping_add(entry(chart_space, j));
                internal = internal.wrapping_add(distance);
                if distance < closest {
                    closest = distance;
                }
            }
            internal = internal.wrapping_sub(closest.wrapping_mul(slide.chart_len));
            let grown = (width + slide.chart_width - closest) as f32;
            let ratio = match (closest <= slide.chart_width, vertical) {
                (true, true) => grown / span,
                (true, false) => span / grown,
                (false, true) => width as f32 / span,
                (false, false) => span / width as f32,
            };
            let tried = &self.tried;
            let closer = if vertical {
                ratio < tried.aspect
            } else {
                ratio > tried.aspect
            };
            let wastes_less = internal < tried.internal_space
                || ((internal.wrapping_sub(tried.internal_space).wrapping_abs() as f32)
                    < tried.internal_space as f32 * 0.05
                    && tried.overlap < closest);
            if closer || ((ratio - tried.aspect).abs() < 1e-6 && wastes_less) {
                self.tried = Tried {
                    turn: self.current_turn,
                    internal_space: internal,
                    position: i,
                    overlap: closest,
                    rotation: slide.rotation,
                    side: slide.side,
                    aspect: ratio,
                };
            }
        }
    }
}
