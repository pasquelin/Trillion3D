//! The distance between the collision level and the drawn level 0, measured both ways: every
//! vertex, edge midpoint and centroid of one side to the nearest triangle of the other, the largest
//! kept (a sampled Hausdorff distance, published as such). Triangles are binned in a uniform grid
//! and a query widens ring by ring until no nearer cell can remain.
use crate::shared_math::WordMap;
use trillion3d_math::aabb::{extend_aabb, longest_side};
use trillion3d_math::triangle::closest_point;
use trillion3d_math::vec3::{dot, sub};

mod bounded;
mod level0;
pub(crate) use bounded::distance_above;
use bounded::one_sided;
pub(crate) use level0::Level0;

type P = [f64; 3];
/// Rings a query widens by before it reads every triangle instead.
const RINGS: i64 = 16;

fn at(pos: &[f32], index: u32) -> P {
    let i = index as usize * 3;
    [pos[i] as f64, pos[i + 1] as f64, pos[i + 2] as f64]
}
/// Squared distance from `p` to triangle `abc` (closest point, found by testing the vertex, edge and face Voronoi regions in turn).
fn triangle_distance2(p: P, a: P, b: P, c: P) -> f64 {
    let d = sub(p, closest_point(p, a, b, c));
    dot(d, d)
}

struct Grid<'a> {
    pos: &'a [f32],
    triangles: &'a [u32],
    origin: P,
    cell: f64,
    cells: WordMap<[i64; 3], Vec<u32>>,
}

impl<'a> Grid<'a> {
    fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        let (mut min, mut max) = ([f64::MAX; 3], [f64::MIN; 3]);
        for &i in triangles {
            extend_aabb(&mut min, &mut max, at(pos, i));
        }
        let extent = longest_side(min, max).max(1e-9);
        // About one triangle per cell along a surface: the cube root is wrong for a surface, the
        // square root of the count per face is right.
        let count = (triangles.len() / 3).max(1) as f64;
        let cell = extent / count.sqrt().max(1.0);
        let mut grid = Self {
            pos,
            triangles,
            origin: min,
            cell,
            cells: WordMap::default(),
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
    /// Distance from `p` to the nearest triangle: rings until the ring is farther or one is within `floor`.
    fn nearest(&self, p: P, floor: f64) -> f64 {
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
                            // A negative floor squares positive: it never stops a sample.
                            if floor >= 0.0 && best <= floor * floor {
                                return best.sqrt();
                            }
                        }
                    }
                }
            }
        }
        best.sqrt()
    }
}

/// Largest distance from the samples of the triangles `from` to the triangles `to`; zero if either is empty.
#[cfg(test)]
pub(crate) fn one_sided_distance(pos: &[f32], from: &[u32], to: &[u32]) -> f64 {
    if from.is_empty() || to.is_empty() {
        return 0.0;
    }
    one_sided(pos, from, &Grid::new(pos, to), 0.0)
}

/// The sampled Hausdorff distance between two triangle sets over the same positions: the tests'
/// one-shot `Level0`.
#[cfg(test)]
pub(crate) fn distance(pos: &[f32], a: &[u32], b: &[u32]) -> f64 {
    Level0::new(pos, a).distance(b)
}
