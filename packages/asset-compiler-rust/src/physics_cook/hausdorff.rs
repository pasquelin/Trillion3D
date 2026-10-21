//! The distance between the collision level and the drawn level 0, measured both ways: every
//! vertex, edge midpoint and centroid of one side to the nearest triangle of the other, the largest
//! kept (a sampled Hausdorff distance, published as such). Triangles are binned in a uniform grid
//! and a query widens ring by ring until no nearer cell can remain.
use trillion3d_math::geometry::aabb::{aabb_of, longest_side};
use trillion3d_math::geometry::triangle::closest_point;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{dot, sub};
use trillion3d_page_codec::hash::WordMap;

mod bounded;
mod level0;
#[cfg(test)]
pub(crate) mod reference;
use bounded::one_sided;
pub(crate) use level0::Level0;

type P = [f64; 3];
/// Rings a query widens by before it reads every triangle instead.
const RINGS: i64 = 16;

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
    /// The least and greatest keys of the binned cells: no cell outside holds a triangle.
    keys: [[i64; 3]; 2],
}

impl<'a> Grid<'a> {
    fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        let binned = || triangles.as_chunks::<3>().0.iter().enumerate();
        let corners = binned().flat_map(|(_, tri)| tri.map(|i| point(pos, i)));
        let (min, max) = aabb_of(corners);
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
            keys: [[i64::MAX; 3], [i64::MIN; 3]],
        };
        // Each triangle in the cells it crosses, not in every cell of its box: a large tilted
        // triangle among small ones would otherwise take a cube of cells.
        for (t, tri) in binned() {
            let corners = tri.map(|i| sub(point(pos, i), min));
            crate::voxel::triangle_cells(corners, cell, None, |c| {
                let c = c.map(i64::from);
                grid.keys = [
                    [0, 1, 2].map(|k| grid.keys[0][k].min(c[k])),
                    [0, 1, 2].map(|k| grid.keys[1][k].max(c[k])),
                ];
                grid.cells.entry(c).or_default().push(t as u32);
            });
        }
        grid
    }
    fn brute(&self, p: P) -> f64 {
        (self.triangles.as_chunks::<3>().0.iter())
            .map(|tri| {
                let [a, b, c] = [0, 1, 2].map(|k| point(self.pos, tri[k]));
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
            // The ring's cells within the binned keys, in order: a whole row along `z` where `x`
            // or `y` lies on the ring, its two ends elsewhere.
            let [(x0, x1, xl, xh), (y0, y1, yl, yh), (z0, z1, zl, zh)] = [0, 1, 2].map(|k| {
                let (low, high) = (centre[k] - ring, centre[k] + ring);
                (
                    low.max(self.keys[0][k]),
                    high.min(self.keys[1][k]),
                    low,
                    high,
                )
            });
            for x in x0..=x1 {
                for y in y0..=y1 {
                    let (from, to, step) = match x == xl || x == xh || y == yl || y == yh {
                        true => (z0, z1, 1),
                        false => (zl, zh, zh - zl),
                    };
                    for z in (from..=to).step_by(step as usize) {
                        let Some(list) = (z0..=z1)
                            .contains(&z)
                            .then(|| self.cells.get(&[x, y, z]))
                            .flatten()
                        else {
                            continue;
                        };
                        for &t in list {
                            let tri = &self.triangles[t as usize * 3..t as usize * 3 + 3];
                            let [a, b, c] = [0, 1, 2].map(|k| point(self.pos, tri[k]));
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
