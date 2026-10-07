//! The live triangles of one texture set, binned by texture island and texture cell, and the
//! source point a coarse sample's coordinate falls on (`texture.rs`).
use crate::shared_math::WordMap;
use trillion3d_math::triangle::barycentric_weights;
use trillion3d_math::vec2::{barycentric, double_area};
use trillion3d_math::vec3::{length, point, sub};
use trillion3d_math::vecn::weighted_sum;

/// Barycentric weights of the samples: corners, edge midpoints, centroid.
const SAMPLES: [[f64; 3]; 7] = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.5, 0.5, 0.0],
    [0.0, 0.5, 0.5],
    [0.5, 0.0, 0.5],
    [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0],
];
/// Barycentric weight below zero still read as inside: a sample on a shared edge is found.
const INSIDE: f64 = -1e-9;
/// Grid cells a triangle may cover before every query of its island reads it instead.
const WIDE: i64 = 64;
/// The texture island of a vertex, `None` for a vertex outside the live triangles.
type Island<'f> = dyn Fn(u32) -> Option<u32> + 'f;

/// The live triangles of one texture set, binned by island and texture cell.
pub(super) struct Lookup<'a> {
    positions: &'a [f32],
    uvs: &'a [f32],
    live: &'a [u32],
    /// Side of a texture cell; not finite when no live triangle maps any texture area.
    cell: f64,
    cells: WordMap<(u32, i64, i64), Vec<usize>>,
    /// Per island, the triangles too wide for the cells, then every triangle.
    wide: WordMap<u32, Vec<usize>>,
    all: WordMap<u32, Vec<usize>>,
}

impl<'a> Lookup<'a> {
    pub(super) fn new(
        positions: &'a [f32],
        uvs: &'a [f32],
        live: &'a [u32],
        island: &Island<'_>,
    ) -> Self {
        let triangles = live.len() / 3;
        let area: f64 = (0..triangles)
            .map(|t| {
                let [a, b, c] = uvs_of(uvs, &live[t * 3..t * 3 + 3]);
                double_area(a, b, c).abs() * 0.5
            })
            .filter(|area| area.is_finite())
            .sum();
        let mut lookup = Self {
            positions,
            uvs,
            live,
            cell: (area / triangles as f64).sqrt() * 2.0,
            cells: WordMap::default(),
            wide: WordMap::default(),
            all: WordMap::default(),
        };
        for t in 0..triangles {
            let Some(home) = island(live[t * 3]) else {
                continue;
            };
            lookup.all.entry(home).or_default().push(t);
            let corners = uvs_of(uvs, &live[t * 3..t * 3 + 3]);
            let side = |start: f64, pick: fn(f64, f64) -> f64| {
                lookup.key([0, 1].map(|a| corners.iter().map(|c| c[a]).fold(start, pick)))
            };
            match (
                side(f64::INFINITY, f64::min),
                side(f64::NEG_INFINITY, f64::max),
            ) {
                // Keys reach 1e15: each side is capped before the product, which would overflow.
                (Some(l), Some(h))
                    if h[0] - l[0] < WIDE
                        && h[1] - l[1] < WIDE
                        && (h[0] - l[0] + 1) * (h[1] - l[1] + 1) <= WIDE =>
                {
                    for x in l[0]..=h[0] {
                        for y in l[1]..=h[1] {
                            lookup.cells.entry((home, x, y)).or_default().push(t);
                        }
                    }
                }
                _ => lookup.wide.entry(home).or_default().push(t),
            }
        }
        lookup
    }

    fn key(&self, at: [f64; 2]) -> Option<[i64; 2]> {
        let key = at.map(|v| (v / self.cell).floor());
        key.iter()
            .all(|k| k.abs() < 1e15)
            .then(|| key.map(|k| k as i64))
    }

    /// The largest deviation over the samples of one coarse triangle, exact above `floor`.
    pub(super) fn triangle(&self, tri: &[u32], island: &Island<'_>, floor: f64) -> f64 {
        let mut homes: Vec<u32> = tri.iter().filter_map(|&v| island(v)).collect();
        homes.sort_unstable();
        homes.dedup();
        let (uvs, spots) = (uvs_of(self.uvs, tri), points_of(self.positions, tri));
        SAMPLES
            .iter()
            .map(|w| {
                let at = weighted_sum(uvs, *w);
                let spot = weighted_sum(spots, *w);
                self.sample(&homes, at, spot, floor)
            })
            .fold(0.0, f64::max)
    }

    /// Distance from `spot` to the live point of `homes` carrying the coordinate `at`: among the
    /// triangles holding `at`, the nearest; when none holds it, the point of the triangle nearest to
    /// `at` in texture space. Zero for a coordinate that is not a number or no triangle maps. A
    /// triangle holding `at` within `floor` of `spot` ends the search: no later one can raise it.
    fn sample(&self, homes: &[u32], at: [f64; 2], spot: [f64; 3], floor: f64) -> f64 {
        if !at.iter().all(|v| v.is_finite()) {
            return 0.0;
        }
        let mut best = (f64::INFINITY, f64::INFINITY);
        let near = self.key(at).map(|[x, y]| {
            homes
                .iter()
                .filter_map(move |&h| self.cells.get(&(h, x, y)))
        });
        let listed = near
            .into_iter()
            .flatten()
            .chain(homes.iter().filter_map(|h| self.wide.get(h)));
        let read = |&t: &usize, best: &mut (f64, f64)| {
            self.read(t, at, spot, best);
            best.0 == 0.0 && best.1 <= floor
        };
        if !listed.flatten().any(|t| read(t, &mut best)) && best.0 > 0.0 {
            let mut every = homes.iter().filter_map(|h| self.all.get(h)).flatten();
            every.any(|t| read(t, &mut best));
        }
        if best.1.is_finite() {
            best.1
        } else {
            0.0
        }
    }

    /// Folds live triangle `t` into `best`, (texture miss, distance), the smaller miss first.
    fn read(&self, t: usize, at: [f64; 2], spot: [f64; 3], best: &mut (f64, f64)) {
        let tri = &self.live[t * 3..t * 3 + 3];
        let [a, b, c] = uvs_of(self.uvs, tri);
        let area = double_area(a, b, c);
        if !(area.abs() > 0.0 && area.is_finite()) {
            return;
        }
        let [v, w] = barycentric(a, b, c, at, area);
        let weights = barycentric_weights(v, w);
        let inside = weights.iter().all(|&k| k >= INSIDE);
        let clamped = weights.map(|k| k.max(0.0));
        let total: f64 = clamped.iter().sum();
        let weights = clamped.map(|k| k / total);
        let miss = if inside {
            0.0
        } else {
            let on = weighted_sum([a, b, c], weights);
            length([at[0] - on[0], at[1] - on[1], 0.0])
        };
        if miss > best.0 {
            return;
        }
        let corners = points_of(self.positions, tri);
        let there = weighted_sum(corners, weights);
        let distance = length(sub(spot, there));
        if miss < best.0 || (miss == best.0 && distance < best.1) {
            *best = (miss, distance);
        }
    }
}

/// A triangle's texture coordinates and positions.
fn uvs_of(uvs: &[f32], tri: &[u32]) -> [[f64; 2]; 3] {
    std::array::from_fn(|k| [0, 1].map(|a| uvs[tri[k] as usize * 2 + a] as f64))
}
fn points_of(positions: &[f32], tri: &[u32]) -> [[f64; 3]; 3] {
    std::array::from_fn(|k| point(positions, tri[k]))
}
