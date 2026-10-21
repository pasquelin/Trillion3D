//! A chart's best placement committed to the board: its corners on the board, whether the board
//! with it still fits the atlas, its grid copied onto the board's empty texels turned by the
//! quarter turns chosen, its transform, and the board's gaps and extent renewed.
use super::board::{cell, column_gaps, row_gaps, set_cell, update};
use super::matrix::{Matrix, PI};
use super::{Packer, CHART_THRESHOLD, DOWN, LEFT, RIGHT, UP};

impl<'d> Packer<'d> {
    /// The chart's corners on the board for the best placement, chart `index`'s turn sizing it.
    fn put_position(&mut self, index: usize) {
        let turn = &self.charts[index].turns[self.tried.turn];
        let (nx, ny) = (turn.num_x, turn.num_y);
        let straight = self.tried.rotation == 0 || self.tried.rotation == 180;
        let (along_x, along_y) = if straight { (nx, ny) } else { (ny, nx) };
        let (position, overlap) = (self.tried.position, self.tried.overlap);
        match self.tried.side {
            UP => self.chart_from = [position, self.from[1] - along_y + overlap],
            RIGHT => self.chart_from = [self.to[0] - overlap, position],
            DOWN => self.chart_from = [position, self.to[1] - overlap],
            LEFT => self.chart_from = [self.from[0] + overlap - along_x, position],
            _ => {}
        }
        if straight || self.tried.rotation == 90 || self.tried.rotation == 270 {
            self.chart_to = [self.chart_from[0] + along_x, self.chart_from[1] + along_y];
        }
    }

    /// Whether the board with the chart still fits the atlas; else the layout is out of range
    /// and, with few charts, the overflow kept as the factor to lower the coverage by.
    fn fits_atlas(&mut self) -> bool {
        let lo = |a: i32, b: i32| if a < b { a } else { b };
        let hi = |a: i32, b: i32| if a > b { a } else { b };
        let width = hi(self.chart_to[0], self.to[0])
            - lo(self.chart_from[0], self.from[0])
            - 2 * self.gutter;
        let height = hi(self.chart_to[1], self.to[1])
            - lo(self.chart_from[1], self.from[1])
            - 2 * self.gutter;
        if width <= self.width as i32 && height <= self.height as i32 {
            return true;
        }
        self.out_of_range = true;
        if self.charts.len() < CHART_THRESHOLD {
            if width > self.width as i32 {
                self.adjust_factor = self.width as f32 / width as f32;
            }
            if height > self.height as i32 {
                self.adjust_factor = self.height as f32 / height as f32;
            }
            self.adjust_factor *= self.adjust_factor;
        }
        false
    }

    /// Chart `index` copied onto the board at its best placement, its transform kept.
    pub(super) fn put_in_position(&mut self, index: usize) {
        self.put_position(index);
        if !self.fits_atlas() {
            return;
        }
        let rotation = self.tried.rotation;
        let turn = &mut self.charts[index].turns[self.tried.turn];
        turn.base = Matrix::rotation(rotation as f32 / 180.0 * PI).apply(turn.base);
        let (base, angle) = (turn.base, turn.angle);
        let turned = Matrix::rotation(rotation as f32 / 180.0 * PI + angle);
        self.current_aspect = self.tried.aspect;
        let ([fx, fy], [tx, ty]) = (self.chart_from, self.chart_to);
        let source = |i: i32, j: i32| match rotation {
            0 => (i - fy, j - fx),
            90 => (tx - j - 1, i - fy),
            180 => (ty - i - 1, tx - j - 1),
            _ => (j - fx, ty - i - 1),
        };
        if matches!(rotation, 0 | 90 | 180 | 270) {
            for i in fy..ty {
                for j in fx..tx {
                    let (y, x) = source(i, j);
                    let value = cell(&self.tried_board, y, x);
                    if cell(&self.board, i, j) != 1 && value != 0 {
                        set_cell(&mut self.board, i, j, value);
                    }
                }
            }
        }
        let corner = match rotation {
            0 => Some((fx, fy)),
            90 => Some((tx, fy)),
            180 => Some((tx, ty)),
            270 => Some((fx, ty)),
            _ => None,
        };
        let shift = corner.map_or(Matrix::identity(), |(x, y)| {
            Matrix::translation(
                self.pixel * x as f32 - base[0],
                self.pixel * y as f32 - base[1],
            )
        });
        self.matrices[index] = turned.then(&shift);
        self.update_space(self.tried.side);
    }

    /// The board's gaps renewed along the chart just placed on side `direction`, and the board's
    /// extent grown to hold it.
    fn update_space(&mut self, direction: usize) {
        let ([cfx, cfy], [ctx, cty]) = (self.chart_from, self.chart_to);
        let ([fx, fy], [tx, ty]) = (self.from, self.to);
        let min = [
            if cfx < fx { cfx } else { fx },
            if cfy < fy { cfy } else { fy },
        ];
        let max = [
            if ctx > tx { ctx } else { tx },
            if cty > ty { cty } else { ty },
        ];
        let occupied = |v: u8| v != 0;
        let widen = |line: &mut Vec<i32>, ranges: [(i32, i32); 2], by: i32| {
            for (a, b) in ranges {
                for i in a..b {
                    update(line, i, |v| v + by);
                }
            }
        };
        match direction {
            UP if cfy < fy => widen(&mut self.space[UP], [(fx, cfx), (ctx, tx)], fy - cfy),
            DOWN if ty < cty => widen(&mut self.space[DOWN], [(fx, cfx), (ctx, tx)], cty - ty),
            LEFT if cfx < fx => widen(&mut self.space[LEFT], [(fy, cfy), (cty, ty)], fx - cfx),
            RIGHT if ctx > tx => widen(&mut self.space[RIGHT], [(fy, cfy), (cty, ty)], ctx - tx),
            _ => {}
        }
        for i in cfx..ctx {
            let (up, down) = column_gaps(&self.board, i, (min[1], max[1]), occupied);
            if direction != DOWN {
                update(&mut self.space[UP], i, |_| up);
            }
            if direction != UP {
                update(&mut self.space[DOWN], i, |_| down);
            }
        }
        for i in cfy..cty {
            let (left, right) = row_gaps(&self.board, i, (min[0], max[0]), occupied);
            if direction != RIGHT {
                update(&mut self.space[LEFT], i, |_| left);
            }
            if direction != LEFT {
                update(&mut self.space[RIGHT], i, |_| right);
            }
        }
        (self.from, self.to) = (min, max);
    }
}
