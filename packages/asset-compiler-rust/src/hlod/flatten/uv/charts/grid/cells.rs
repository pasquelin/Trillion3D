//! The uniform grid the crossing test sorts a large set of edges into, and the walk of a segment
//! through its cells.
//!
//! The edges are sorted on the first test that needs the grid: the edges' box split in cells about
//! one edge long on its longer side (that side over the edge count held between 32 and 512), each
//! edge listed in the cells its segment walks through (Amanatides and Woo's voxel walk, from the
//! start cell to the end cell); a test then walks its own segment and tries the edges listed in
//! those cells, in ascending order, once each. A grid of no cell size or of a single row or column
//! is never built: the test stays pair by pair.
use super::super::mesh::NONE;
use super::super::vector::{bounds2, most, unit_or, Vec2, EPSILON};
use super::{Corners, EdgeGrid};
use trillion3d_math::vector::vecn::sub;

impl EdgeGrid {
    /// Sorts the edges into cells; `false` when the box is too thin for a grid.
    pub(super) fn build(&mut self, corners: Corners) -> bool {
        let ends = (self.edges.iter()).flat_map(|&edge| [corners.start(edge), corners.end(edge)]);
        let (low, high) = bounds2(ends);
        self.origin = low;
        let size = sub(high, low);
        self.cell_size = most(size[0], size[1]) / self.edges.len().clamp(32, 512) as f32;
        if self.cell_size <= 0.0 {
            return false;
        }
        self.width = (size[0] / self.cell_size).ceil() as u32;
        self.height = (size[1] / self.cell_size).ceil() as u32;
        if self.width <= 1 || self.height <= 1 {
            return false;
        }
        let cells = (self.width * self.height) as usize;
        self.heads.clear();
        self.heads.resize(cells, NONE);
        self.tails.clear();
        self.tails.resize(cells, NONE);
        self.entries.clear();
        for i in 0..self.edges.len() {
            let edge = self.edges[i];
            self.walk(corners.start(edge), corners.end(edge));
            for j in 0..self.walked.len() {
                let cell = self.walked[j] as usize;
                let entry = self.entries.len();
                self.entries.push((edge, NONE));
                if self.heads[cell] == NONE {
                    self.heads[cell] = entry;
                } else {
                    self.entries[self.tails[cell]].1 = entry;
                }
                self.tails[cell] = entry;
            }
        }
        true
    }

    /// The edges listed in the cells the segment `p1 p2` walks through, in ascending order.
    pub(super) fn potential_edges(&mut self, p1: Vec2, p2: Vec2) {
        self.potential.clear();
        self.walk(p1, p2);
        for &cell in &self.walked {
            let mut entry = self.heads[cell as usize];
            while entry != NONE {
                let (edge, next) = self.entries[entry];
                self.potential.push(edge);
                entry = next;
            }
        }
        self.potential.sort_unstable();
    }

    /// The cells the segment `p1 p2` walks through, from the start cell: each step crosses into the
    /// neighbour whose border is nearer along the segment, until the end cell, the grid's edge, or
    /// a step past the end cell's row or column.
    fn walk(&mut self, p1: Vec2, p2: Vec2) {
        let direction = sub(p2, p1);
        let normal = unit_or(direction, [0.0; 2]);
        let step_x: i32 = if direction[0] >= 0.0 { 1 } else { -1 };
        let step_y: i32 = if direction[1] >= 0.0 { 1 } else { -1 };
        let first = [self.cell_x(p1[0]), self.cell_y(p1[1])];
        let last = [self.cell_x(p2[0]), self.cell_y(p2[1])];
        let to_next_x = if step_x == 1 {
            (first[0] + 1) as f32 * self.cell_size - (p1[0] - self.origin[0])
        } else {
            (p1[0] - self.origin[0]) - first[0] as f32 * self.cell_size
        };
        let to_next_y = if step_y == 1 {
            (first[1] + 1) as f32 * self.cell_size - (p1[1] - self.origin[1])
        } else {
            (p1[1] - self.origin[1]) - first[1] as f32 * self.cell_size
        };
        let steps = |to_next: f32, step: i32, n: f32| {
            if n.abs() > EPSILON {
                (
                    (to_next * step as f32) / n,
                    (self.cell_size * step as f32) / n,
                )
            } else {
                (f32::MAX, f32::MAX)
            }
        };
        let (mut t_x, delta_x) = steps(to_next_x, step_x, normal[0]);
        let (mut t_y, delta_y) = steps(to_next_y, step_y, normal[1]);
        self.walked.clear();
        self.walked.push(first[0] + first[1] * self.width);
        let mut cell = first;
        while cell != last {
            if t_x < t_y {
                t_x += delta_x;
                cell[0] = cell[0].wrapping_add(step_x as u32);
            } else {
                t_y += delta_y;
                cell[1] = cell[1].wrapping_add(step_y as u32);
            }
            if cell[0] >= self.width || cell[1] >= self.height {
                break;
            }
            let past_x = if step_x == 1 {
                cell[0] > last[0]
            } else {
                cell[0] < last[0]
            };
            let past_y = if step_y == 1 {
                cell[1] > last[1]
            } else {
                cell[1] < last[1]
            };
            if past_x || past_y {
                break;
            }
            self.walked.push(cell[0] + cell[1] * self.width);
        }
    }

    /// The column of `x`, held in the grid.
    fn cell_x(&self, x: f32) -> u32 {
        (most(0.0, (x - self.origin[0]) / self.cell_size) as u32).min(self.width - 1)
    }

    /// The row of `y`, held in the grid.
    fn cell_y(&self, y: f32) -> u32 {
        (most(0.0, (y - self.origin[1]) / self.cell_size) as u32).min(self.height - 1)
    }
}
