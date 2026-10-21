//! A chart turned in its plane and boxed: the turn about a centre, the box of its boundary
//! vertices once turned, and its least box over a fan of turns.
//!
//! The least box: the box of every vertex first, then the boundary's box at each of the
//! `turns − 1` angles `k·π / (2·turns)`, the one of least squared diagonal kept; the chart is then
//! turned by the angle kept when it is more than `ZERO`.
use super::Chart;
use crate::hlod::flatten::uv::extremes::{greater, lesser};
use crate::hlod::flatten::uv::spectral::util::{box_size, turn, ZERO};
use std::f32::consts::PI;

impl<'a> Chart<'a> {
    /// Every vertex turned by `angle` about `center`.
    pub(crate) fn rotate(&mut self, center: [f32; 2], angle: f32) {
        let (cos, sin) = (angle.cos(), angle.sin());
        for v in &mut self.verts {
            v.uv = turn(v.uv, center, sin, cos);
        }
    }

    /// The box, low and high corners, of the boundary vertices turned by `angle` about `center`.
    pub(crate) fn rotated_bounds(&self, center: [f32; 2], angle: f32) -> ([f32; 2], [f32; 2]) {
        let (cos, sin) = (angle.cos(), angle.sin());
        let mut low = [f32::MAX; 2];
        let mut high = [-f32::MAX; 2];
        for v in self.verts.iter().filter(|v| v.boundary) {
            let p = turn(v.uv, center, sin, cos);
            low = [lesser(p[0], low[0]), lesser(p[1], low[1])];
            high = [greater(p[0], high[0]), greater(p[1], high[1])];
        }
        (low, high)
    }

    /// The least box over `turns` angles, the chart turned to it; its low and high corners.
    pub(crate) fn fit_bounds(&mut self, turns: usize) -> ([f32; 2], [f32; 2]) {
        let mut low = [f32::MAX; 2];
        let mut high = [-f32::MAX; 2];
        for v in &self.verts {
            low = [lesser(v.uv[0], low[0]), lesser(v.uv[1], low[1])];
            high = [greater(v.uv[0], high[0]), greater(v.uv[1], high[1])];
        }
        let center = [(low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0];
        let mut least = box_size(low, high);
        let mut best_angle = 0.0;
        for k in 1..turns {
            let angle = k as f32 * PI / (turns * 2) as f32;
            let (l, h) = self.rotated_bounds(center, angle);
            let size = box_size(l, h);
            if size < least {
                least = size;
                best_angle = angle;
                (low, high) = (l, h);
            }
        }
        if best_angle > ZERO {
            self.rotate(center, best_angle);
        }
        (low, high)
    }
}
