//! The samples of one axis camera over a cooked cut: the nearest front face per sample, back faces
//! culled as the renderer culls them, and a square filter around each sample.
use super::silhouette::{Mesh, Point};
use trillion3d_math::triangle::triangle_cross;

/// Samples of one view: a square grid over the source's projection, `step` apart.
pub(super) struct Grid {
    pub axis: usize,
    pub sign: f64,
    pub origin: [f64; 2],
    pub step: f64,
    pub size: [usize; 2],
}

impl Grid {
    fn plane(&self) -> [usize; 2] {
        [(self.axis + 1) % 3, (self.axis + 2) % 3]
    }
    /// Nearest front-facing depth per sample (`sign · p[axis]`, larger is nearer), `-inf` where
    /// no front face covers it.
    pub fn raster(&self, mesh: &Mesh, indices: &[u32]) -> Vec<f64> {
        let [u, v] = self.plane();
        let mut depth = vec![f64::NEG_INFINITY; self.size[0] * self.size[1]];
        for t in indices.chunks(3) {
            let p = [0, 1, 2].map(|k| mesh.positions[t[k] as usize]);
            if self.sign * triangle_cross(p[0], p[1], p[2])[self.axis] <= 0.0 {
                continue;
            }
            let area = (p[1][u] - p[0][u]) * (p[2][v] - p[0][v])
                - (p[2][u] - p[0][u]) * (p[1][v] - p[0][v]);
            let cell = |a: usize, x: f64| (x - self.origin[a]) / self.step;
            let range = |a: usize, c: usize| {
                let values = p.map(|q| cell(a, q[c]));
                let low = values
                    .iter()
                    .copied()
                    .fold(f64::INFINITY, f64::min)
                    .ceil()
                    .max(0.0);
                let high = values
                    .iter()
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max)
                    .floor();
                low as usize..(high + 1.0).clamp(0.0, self.size[a] as f64) as usize
            };
            for i in range(0, u) {
                for j in range(1, v) {
                    let (x, y) = (
                        self.origin[0] + i as f64 * self.step,
                        self.origin[1] + j as f64 * self.step,
                    );
                    let edge = |a: Point, b: Point| {
                        (b[u] - a[u]) * (y - a[v]) - (x - a[u]) * (b[v] - a[v])
                    };
                    let w =
                        [edge(p[1], p[2]), edge(p[2], p[0]), edge(p[0], p[1])].map(|e| e / area);
                    if w.iter().any(|&w| w < -1e-9) {
                        continue;
                    }
                    let z = self.sign
                        * (w[0] * p[0][self.axis]
                            + w[1] * p[1][self.axis]
                            + w[2] * p[2][self.axis]);
                    let slot = &mut depth[i * self.size[1] + j];
                    *slot = slot.max(z);
                }
            }
        }
        depth
    }
    /// `fold` of `values` over the square of `radius` samples around each sample, separably.
    pub fn filter(&self, values: &[f64], radius: usize, fold: fn(f64, f64) -> f64) -> Vec<f64> {
        let [n, m] = self.size;
        let pass = |input: &[f64], along_rows: bool| -> Vec<f64> {
            let mut out = input.to_vec();
            for i in 0..n {
                for j in 0..m {
                    let (c, len) = if along_rows { (i, n) } else { (j, m) };
                    for k in c.saturating_sub(radius)..(c + radius + 1).min(len) {
                        let at = if along_rows { k * m + j } else { i * m + k };
                        out[i * m + j] = fold(out[i * m + j], input[at]);
                    }
                }
            }
            out
        };
        pass(&pass(values, true), false)
    }
}
