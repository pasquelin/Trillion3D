//! What six axis cameras see of a cooked cut, against its source (#415).
//!
//! A cut at threshold `t` is every page whose own error is at most `t` and whose parent's is above
//! it: the pages a renderer draws at that distance. Each camera looks along one signed axis and
//! keeps, per sample, the nearest FRONT face, back faces culled as the renderer culls them. Where
//! the source covers a whole disc of the cut's error around a sample, the cut must draw a front
//! face within that disc, no further than the error behind the source: a wall wider than the error
//! is neither pruned nor turned away, and a seam narrower than the error may open. Separately, no
//! cut triangle may face against the normals of the source vertices it names.
use super::*;
use crate::shared_math::{cross, dot, sub};

type Point = [f64; 3];

/// One source primitive: its vertices and, per corner, the vertex it draws.
#[derive(Default)]
pub(in crate::tests) struct Mesh {
    pub positions: Vec<Point>,
    pub normals: Vec<Point>,
    pub indices: Vec<u32>,
}

/// Samples of one view: a square grid over the source's projection, `step` apart.
struct Grid {
    axis: usize,
    sign: f64,
    origin: [f64; 2],
    step: f64,
    size: [usize; 2],
}

impl Grid {
    fn plane(&self) -> [usize; 2] {
        [(self.axis + 1) % 3, (self.axis + 2) % 3]
    }
    /// Nearest front-facing depth per sample (`sign · p[axis]`, larger is nearer), `-inf` where
    /// no front face covers it.
    fn raster(&self, mesh: &Mesh, indices: &[u32]) -> Vec<f64> {
        let [u, v] = self.plane();
        let mut depth = vec![f64::NEG_INFINITY; self.size[0] * self.size[1]];
        for t in indices.chunks(3) {
            let p = [0, 1, 2].map(|k| mesh.positions[t[k] as usize]);
            if self.sign * cross(sub(p[1], p[0]), sub(p[2], p[0]))[self.axis] <= 0.0 {
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
    fn filter(&self, values: &[f64], radius: usize, fold: fn(f64, f64) -> f64) -> Vec<f64> {
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

/// Each cut of `primitive` against `mesh`, its source, one line per defect.
pub(in crate::tests) fn cut_defects(objects: &Path, primitive: &Value, mesh: &Mesh) -> Vec<String> {
    let pages = primitive["pages"].as_array().expect("pages");
    let indices: Vec<Vec<u32>> = pages
        .iter()
        .map(|page| {
            let raw =
                fs::read(objects.join(format!("{}.bin", page["sha256"].as_str().expect("sha"))));
            raw.expect("index object")
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| u32::from_le_bytes(*b))
                .collect()
        })
        .collect();
    let error = |page: &Value, key: &str| page[key].as_f64().unwrap_or(f64::INFINITY);
    let mut thresholds: Vec<f64> = pages.iter().map(|p| error(p, "lodError")).collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    let (low, high) = (0..3).fold(
        ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]),
        |(mut lo, mut hi), a| {
            for p in &mesh.positions {
                (lo[a], hi[a]) = (lo[a].min(p[a]), hi[a].max(p[a]));
            }
            (lo, hi)
        },
    );
    let diagonal = crate::shared_math::length(sub(high, low));
    let mut defects = Vec::new();
    for t in thresholds {
        let cut: Vec<u32> = pages
            .iter()
            .zip(&indices)
            .filter(|(p, _)| error(p, "lodError") <= t && error(p, "parentError") > t)
            .flat_map(|(_, i)| i.iter().copied())
            .collect();
        for c in cut.chunks(3) {
            let p = [0, 1, 2].map(|k| mesh.positions[c[k] as usize]);
            let n = [0, 1, 2].map(|k| mesh.normals[c[k] as usize]);
            let facing = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            if dot(facing, std::array::from_fn(|a| n[0][a] + n[1][a] + n[2][a])) < 0.0 {
                defects.push(format!("cut {t}: triangle {p:?} faces against its normals"));
            }
        }
        // An eighth of the error, never finer than the object's own 1/256th: the check's resolution.
        let step = (t / 8.0).max(diagonal / 256.0);
        let radius = (t / step).ceil() as usize;
        for axis in 0..3 {
            for sign in [-1.0, 1.0] {
                let [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
                // A margin of `radius` empty samples: past the object's edge nothing covers.
                let size =
                    [u, v].map(|a| ((high[a] - low[a]) / step).ceil() as usize + 1 + 2 * radius);
                let grid = Grid {
                    axis,
                    sign,
                    origin: [u, v].map(|a| low[a] - radius as f64 * step),
                    step,
                    size,
                };
                let source = grid.raster(mesh, &mesh.indices);
                let drawn = grid.raster(mesh, &cut);
                let solid = grid.filter(&source, radius, f64::min);
                let reach = grid.filter(&drawn, radius, f64::max);
                let slack = t + 2.0 * step;
                let lost = (0..source.len())
                    .filter(|&s| solid[s].is_finite() && reach[s] < solid[s] - slack)
                    .count();
                if lost > 0 {
                    let wanted = solid.iter().filter(|d| d.is_finite()).count();
                    defects.push(format!(
                        "cut {t}: view {sign}·axis {axis} loses {lost} of {wanted} samples"
                    ));
                }
            }
        }
    }
    defects
}
