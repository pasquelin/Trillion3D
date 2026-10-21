//! The texel size, the board each layout starts from, and the layout scaled into the unit square.
//!
//! - The texel size: `√(chart area / (coverage · width · height))`. The first coverage, 60%, is
//!   divided by 1.01 until the longest chart fits the atlas. After a layout overflows: with fewer
//!   than 30 charts the coverage is scaled by the squared ratio of the atlas to the overflowing
//!   size, less 0.5%; with more, lowered by a quarter of the share of area left out plus a tenth of
//!   the share of charts left out (between 1% and 20%), giving up past 200 restarts. A coverage
//!   that falls to zero becomes 90% of the last.
//! - A chart's texels in each turn: its box over the texel size, rounded up (at least one), the
//!   chart centred in them, a gutter added on each side.
//! - Each layout clears the board, rasterises the longest chart at its centre and reads the
//!   board's side gaps.
//! - The final layout is moved to the origin past the gutter and scaled so its longer side (by the
//!   atlas's aspect ratio) spans 1.
use super::board::{cell, fill_space, set_cell};
use super::matrix::Matrix;
use super::{Packer, CHART_THRESHOLD, MAX_ITERATION};
use crate::hlod::flatten::uv::spectral::fail::invalid_argument;

/// The first coverage.
const FIRST_COVERAGE: f32 = 0.6;
/// The coverage is divided by this until the longest chart fits.
const COVERAGE_STEP: f32 = 1.01;

/// `x` truncated to an integer as the hardware does: the least integer for a NaN or a value out
/// of range.
pub(super) fn to_int(x: f32) -> i32 {
    if !(-2_147_483_648.0..2_147_483_648.0).contains(&x) {
        i32::MIN
    } else {
        x as i32
    }
}

impl<'d> Packer<'d> {
    /// The texel size for the current coverage.
    fn texel_size(&self) -> f32 {
        (self.total_area / (self.percent * self.width as f32 * self.height as f32)).sqrt()
    }

    /// The coverage lowered until the longest chart fits the atlas.
    pub(super) fn initial_coverage(&mut self) {
        self.percent = FIRST_COVERAGE;
        loop {
            self.pixel = self.texel_size();
            let turn = &self.charts[self.sorted[0] as usize].turns[0];
            let num_x = to_int(((turn.high[0] - turn.low[0]) / self.pixel).ceil());
            let num_y = to_int(((turn.high[1] - turn.low[1]) / self.pixel).ceil());
            if num_x <= self.width as i32 && num_y <= self.height as i32 {
                break;
            }
            self.percent /= COVERAGE_STEP;
        }
    }

    /// The coverage lowered after a layout overflowed.
    pub(super) fn lower_coverage(&mut self) {
        let old = self.percent;
        if self.charts.len() < CHART_THRESHOLD {
            self.percent *= self.adjust_factor;
            self.percent -= 0.005;
        } else {
            let unpacked_area = 1.0 - self.packed_area / self.total_area;
            let unpacked_charts = 1.0 - self.packed_charts as f32 / self.charts.len() as f32;
            let mut factor = unpacked_area / 4.0 + unpacked_charts / 10.0;
            if factor < 0.02 {
                factor = 0.01;
            }
            if factor > 0.2 {
                factor = 0.2;
            }
            self.percent -= factor;
            if self.iterations > MAX_ITERATION {
                self.stop = true;
                return;
            }
        }
        if self.percent <= 0.0 {
            self.percent = old * 0.9;
        }
        self.pixel = self.texel_size();
    }

    /// Every valid chart's texels in each turn.
    fn chart_lengths(&mut self) {
        let (pixel, gutter) = (self.pixel, self.gutter);
        for chart in self.charts.iter_mut().filter(|c| c.valid) {
            for turn in &mut chart.turns {
                let (w, h) = (turn.high[0] - turn.low[0], turn.high[1] - turn.low[1]);
                let at_least_one = |n: i32| if n == 0 { 1 } else { n };
                let num_x = at_least_one(to_int((w / pixel).ceil()));
                let num_y = at_least_one(to_int((h / pixel).ceil()));
                let adjust = [
                    (num_x as f32 * pixel - w) / 2.0,
                    (num_y as f32 * pixel - h) / 2.0,
                ];
                turn.adjust = adjust;
                turn.base = [
                    turn.low[0] - gutter as f32 * pixel - adjust[0],
                    turn.low[1] - gutter as f32 * pixel - adjust[1],
                ];
                turn.num_x = num_x + 2 * gutter;
                turn.num_y = num_y + 2 * gutter;
            }
        }
    }

    /// The board cleared, the grids sized, the longest chart placed at the board's centre.
    pub(super) fn prepare_board(&mut self) -> crate::Result<()> {
        for row in &mut self.board {
            row.fill(0);
        }
        let index = self.sorted[0] as usize;
        self.chart_lengths();
        let (num_x, num_y) = (
            self.charts[index].turns[0].num_x,
            self.charts[index].turns[0].num_y,
        );
        let size = 2 * if num_x < num_y { num_y } else { num_x };
        if size <= 0 {
            return Err(invalid_argument("a chart has no size in texels"));
        }
        let size = size as usize;
        for grid in [&mut self.chart_board, &mut self.tried_board] {
            grid.resize(size, Vec::new());
            for row in grid.iter_mut() {
                row.resize(size, 0);
            }
        }
        let board_side = self.board_width.max(self.board_height);
        for k in 0..4 {
            self.chart_space[k].resize(size, 0);
            self.space[k].resize(board_side, 0);
        }
        self.tessellate(index, 0);
        self.current_aspect = num_y as f32 / num_x as f32;
        self.from[1] = self.board.len() as i32 / 2 - num_y / 2;
        self.to[1] = self.from[1] + num_y;
        self.from[0] = self.board[0].len() as i32 / 2 - num_x / 2;
        self.to[0] = self.from[0] + num_x;
        for i in self.from[1]..self.to[1] {
            for j in self.from[0]..self.to[0] {
                let value = cell(&self.chart_board, i - self.from[1], j - self.from[0]);
                set_cell(&mut self.board, i, j, value);
            }
        }
        let base = self.charts[index].turns[0].base;
        self.matrices[index] = Matrix::translation(
            self.pixel * self.from[0] as f32 - base[0],
            self.pixel * self.from[1] as f32 - base[1],
        );
        fill_space(
            &mut self.space,
            &self.board,
            (self.from[0], self.to[0]),
            (self.from[1], self.to[1]),
            false,
        );
        Ok(())
    }

    /// The side the layout is normalised by: its height when taller than the atlas's aspect
    /// ratio, else its width, gutters excluded.
    pub(super) fn final_rect(&mut self) {
        let num_x = self.to[0] - self.from[0] - self.gutter * 2;
        let num_y = self.to[1] - self.from[1] - self.gutter * 2;
        self.normalize_len = if num_y as f32 / num_x as f32 > self.aspect {
            num_y
        } else {
            num_x
        };
    }

    /// Every chart's plane positions moved and scaled into the unit square, a left-out chart's
    /// to the origin.
    pub(super) fn normalize(&mut self) {
        let shift = Matrix::translation(
            -self.pixel * (self.from[0] + self.gutter) as f32,
            -self.pixel * (self.from[1] + self.gutter) as f32,
        );
        let factor = 1.0 / self.pixel / self.normalize_len as f32;
        let scaling = Matrix::scaling(factor, factor);
        for (i, range) in self.ranges.iter().enumerate() {
            let points = &mut self.uvs[range.vertex_start..range.vertex_start + range.vertex_count];
            if !self.charts[i].valid {
                points.fill([0.0, 0.0]);
                continue;
            }
            let matrix = self.matrices[i].then(&shift).then(&scaling);
            for p in points {
                *p = matrix.apply(*p);
            }
        }
    }
}
