//! The distance between the collision level and the drawn level 0, measured both ways: every
//! vertex, edge midpoint and centroid of one side to the nearest triangle of the other, the largest
//! kept (a sampled Hausdorff distance, published as such). Triangles are binned in a uniform grid
//! and a query widens ring by ring until no nearer cell can remain.
use rayon::prelude::*;
use std::collections::HashMap;

type P = [f64; 3];
/// Rings a query widens by before it reads every triangle instead.
const RINGS: i64 = 16;

fn at(pos: &[f32], index: u32) -> P {
    let i = index as usize * 3;
    [pos[i] as f64, pos[i + 1] as f64, pos[i + 2] as f64]
}
fn sub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn lerp(a: P, b: P, w: f64) -> P {
    [
        a[0] + (b[0] - a[0]) * w,
        a[1] + (b[1] - a[1]) * w,
        a[2] + (b[2] - a[2]) * w,
    ]
}

/// Squared distance from `p` to triangle `abc` (closest point by Voronoi region, Ericson 5.1.5).
fn triangle_distance2(p: P, a: P, b: P, c: P) -> f64 {
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    let closest = if d1 <= 0.0 && d2 <= 0.0 {
        a
    } else {
        let bp = sub(p, b);
        let (d3, d4) = (dot(ab, bp), dot(ac, bp));
        let cp = sub(p, c);
        let (d5, d6) = (dot(ab, cp), dot(ac, cp));
        let (vc, vb, va) = (d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4);
        if d3 >= 0.0 && d4 <= d3 {
            b
        } else if d6 >= 0.0 && d5 <= d6 {
            c
        } else if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
            lerp(a, b, d1 / (d1 - d3))
        } else if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
            lerp(a, c, d2 / (d2 - d6))
        } else if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
            lerp(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6)))
        } else {
            let denom = 1.0 / (va + vb + vc);
            let (v, w) = (vb * denom, vc * denom);
            [0, 1, 2].map(|k| a[k] + ab[k] * v + ac[k] * w)
        }
    };
    let d = sub(p, closest);
    dot(d, d)
}

struct Grid<'a> {
    pos: &'a [f32],
    triangles: &'a [u32],
    origin: P,
    cell: f64,
    cells: HashMap<[i64; 3], Vec<u32>>,
}

impl<'a> Grid<'a> {
    fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        let (mut min, mut max) = ([f64::MAX; 3], [f64::MIN; 3]);
        for &i in triangles {
            let p = at(pos, i);
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        let extent = (0..3)
            .map(|k| max[k] - min[k])
            .fold(0.0, f64::max)
            .max(1e-9);
        // About one triangle per cell along a surface: the cube root is wrong for a surface, the
        // square root of the count per face is right.
        let count = (triangles.len() / 3).max(1) as f64;
        let cell = extent / count.sqrt().max(1.0);
        let mut grid = Self {
            pos,
            triangles,
            origin: min,
            cell,
            cells: HashMap::new(),
        };
        for (t, tri) in triangles.as_chunks::<3>().0.iter().enumerate() {
            let (lo, hi) = tri
                .iter()
                .fold(([i64::MAX; 3], [i64::MIN; 3]), |(lo, hi), &i| {
                    let c = grid.key(at(pos, i));
                    (
                        [0, 1, 2].map(|k| lo[k].min(c[k])),
                        [0, 1, 2].map(|k| hi[k].max(c[k])),
                    )
                });
            for x in lo[0]..=hi[0] {
                for y in lo[1]..=hi[1] {
                    for z in lo[2]..=hi[2] {
                        grid.cells.entry([x, y, z]).or_default().push(t as u32);
                    }
                }
            }
        }
        grid
    }
    fn brute(&self, p: P) -> f64 {
        self.triangles
            .as_chunks::<3>()
            .0
            .iter()
            .map(|tri| {
                let [a, b, c] = [0, 1, 2].map(|k| at(self.pos, tri[k]));
                triangle_distance2(p, a, b, c)
            })
            .fold(f64::MAX, f64::min)
            .sqrt()
    }
    fn key(&self, p: P) -> [i64; 3] {
        [0, 1, 2].map(|k| ((p[k] - self.origin[k]) / self.cell).floor() as i64)
    }
    /// Distance from `p` to the nearest triangle: rings of cells until the ring is farther.
    fn nearest(&self, p: P) -> f64 {
        let centre = self.key(p);
        let mut best = f64::MAX;
        for ring in 0i64.. {
            if ring > 0 && ((ring - 1) as f64 * self.cell).powi(2) > best {
                break;
            }
            // Far from every cell (an outlier): every triangle, once, rather than rings of nothing.
            if ring > RINGS {
                return self.brute(p);
            }
            for x in -ring..=ring {
                for y in -ring..=ring {
                    for z in -ring..=ring {
                        if x.abs().max(y.abs()).max(z.abs()) != ring {
                            continue;
                        }
                        let Some(list) =
                            self.cells
                                .get(&[centre[0] + x, centre[1] + y, centre[2] + z])
                        else {
                            continue;
                        };
                        for &t in list {
                            let tri = &self.triangles[t as usize * 3..t as usize * 3 + 3];
                            let [a, b, c] = [0, 1, 2].map(|k| at(self.pos, tri[k]));
                            best = best.min(triangle_distance2(p, a, b, c));
                        }
                    }
                }
            }
        }
        best.sqrt()
    }
}

/// Largest distance from the samples of `from` to the triangles of `to`.
fn one_sided(pos: &[f32], from: &[u32], to: &Grid) -> f64 {
    from.par_chunks_exact(3)
        .map(|tri| {
            let [a, b, c] = [0, 1, 2].map(|k| at(pos, tri[k]));
            let centroid = [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) / 3.0);
            [
                a,
                b,
                c,
                lerp(a, b, 0.5),
                lerp(b, c, 0.5),
                lerp(c, a, 0.5),
                centroid,
            ]
            .into_iter()
            .map(|p| to.nearest(p))
            .fold(0.0, f64::max)
        })
        .reduce(|| 0.0, f64::max)
}

/// Largest distance from the samples of the triangles `from` to the triangles `to`; zero if either is empty.
pub(crate) fn one_sided_distance(pos: &[f32], from: &[u32], to: &[u32]) -> f64 {
    if from.is_empty() || to.is_empty() {
        return 0.0;
    }
    one_sided(pos, from, &Grid::new(pos, to))
}

/// The sampled Hausdorff distance between two triangle sets over the same positions.
pub(crate) fn distance(pos: &[f32], a: &[u32], b: &[u32]) -> f64 {
    one_sided_distance(pos, a, b).max(one_sided_distance(pos, b, a))
}
