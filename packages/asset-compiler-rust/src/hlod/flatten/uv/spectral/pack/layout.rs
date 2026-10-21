//! The packing's entry: the input checked as the library checks it, the charts prepared, the
//! layouts tried until one fits the atlas, the result written back over the partition's vertices
//! (a vertex no face names keeps its position), and the random generator's state handed back.
use super::matrix::Matrix;
use super::scale::to_int;
use super::{order, ChartInfo, Packer, Turn, BOARD_FACTOR, TURNS};
use crate::hlod::flatten::uv::spectral::fail::invalid_argument;
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use crate::hlod::flatten::uv::spectral::Charted;
use std::cell::Cell;

/// `charted.uvs` packed for a `width`×`height` texture with `gutter` texels.
pub(crate) fn pack_charted(
    charted: &mut Charted,
    width: usize,
    height: usize,
    gutter: f32,
) -> crate::Result<()> {
    let vertex_count = charted.uvs.len();
    let faces = charted.indices.len() / 3;
    let too_wide = |n: usize| n as u64 > u32::MAX as u64;
    if width == 0 || height == 0 || too_wide(width) || too_wide(height) {
        return Err(invalid_argument("the atlas size"));
    }
    let too_many = vertex_count as u64 >= u32::MAX as u64 || 3 * faces as u64 >= u32::MAX as u64;
    if vertex_count == 0 || faces == 0 || too_many {
        return Err(invalid_argument("no vertex or no face, or too many"));
    }
    if charted.cut_adjacency.len() != 3 * faces || charted.indices.len() != 3 * faces {
        return Err(invalid_argument("the partition's adjacency"));
    }
    if charted.indices.iter().any(|&i| i as usize >= vertex_count) {
        return Err(invalid_argument("an index names no vertex"));
    }
    if gutter < 1.0 {
        return Err(invalid_argument("the gutter is under one texel"));
    }
    let draw = Cell::new(charted.draw);
    let mut packer = Packer::new(&draw, width, height, to_int(gutter));
    packer.collect_charts(&charted.cut_adjacency, &charted.indices, &charted.uvs);
    if !packer.possible() {
        return Err(invalid_argument(
            "the gutter is too wide or the atlas too small",
        ));
    }
    packer.prepare_charts()?;
    packer.run()?;
    for (uv, &local) in charted.uvs.iter_mut().zip(&packer.local_of) {
        if local != NONE {
            *uv = packer.uvs[local as usize];
        }
    }
    charted.draw = draw.get();
    Ok(())
}

impl<'d> Packer<'d> {
    /// Whether the atlas can hold as many charts as there are, a texel and a gutter each.
    fn possible(&self) -> bool {
        let step = self.gutter.wrapping_add(1) as i64 as u64;
        let cells = (self.height as u64 / step).wrapping_mul(self.width as u64) / step;
        cells > self.ranges.len() as u64
    }

    /// The board sized and every chart turned and measured, sorted, the coverage estimated.
    fn prepare_charts(&mut self) -> crate::Result<()> {
        let count = self.ranges.len();
        let info = ChartInfo {
            turns: vec![Turn::default(); TURNS],
            ..ChartInfo::default()
        };
        self.charts = vec![info; count];
        self.sorted = (0..count as u32).collect();
        self.matrices = vec![Matrix::identity(); count];
        self.board_width = BOARD_FACTOR * self.width + 2 * self.gutter as usize;
        self.board_height = BOARD_FACTOR * self.height + 2 * self.gutter as usize;
        self.board = vec![vec![0; self.board_width]; self.board_height];
        self.measure_charts()?;
        let charts = &self.charts;
        let longer = |&a: &u32, &b: &u32| charts[a as usize].longest > charts[b as usize].longest;
        order::sort(&mut self.sorted, &longer);
        self.initial_coverage();
        Ok(())
    }

    /// Layouts tried until one fits, then scaled into the unit square.
    fn run(&mut self) -> crate::Result<()> {
        loop {
            self.out_of_range = false;
            self.lay_out()?;
            if self.out_of_range {
                self.iterations += 1;
                self.lower_coverage();
            }
            if self.stop || !self.out_of_range {
                break;
            }
        }
        if self.stop {
            return Err(invalid_argument("the charts do not fit the atlas"));
        }
        self.final_rect();
        self.normalize();
        Ok(())
    }

    /// One layout: the longest chart placed, then the others in order until one overflows.
    fn lay_out(&mut self) -> crate::Result<()> {
        self.prepare_board()?;
        let first = self.sorted[0] as usize;
        self.packed_area = self.charts[first].area;
        self.packed_charts = 1;
        for i in 1..self.sorted.len() {
            let index = self.sorted[i] as usize;
            self.put_chart(index);
            if self.out_of_range {
                break;
            }
            self.packed_charts += 1;
            self.packed_area += self.charts[index].area;
        }
        Ok(())
    }
}
