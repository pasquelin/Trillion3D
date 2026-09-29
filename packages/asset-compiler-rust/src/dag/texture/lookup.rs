//! The live triangles of one texture set, binned by texture island and texture cell, and the
//! source point a coarse sample's coordinate falls on (`texture.rs`).
use crate::shared_math::{length, point, sub};
use std::collections::HashMap;

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

/// The live triangles of one texture set, binned by island and texture cell.
pub(super) struct Lookup<'a> {
    positions: &'a [f32],
    uvs: &'a [f32],
    live: &'a [u32],
    /// Side of a texture cell; not finite when no live triangle maps any texture area.
    cell: f64,
    cells: HashMap<(u32, i64, i64), Vec<usize>>,
    /// Per island, the triangles too wide for the cells, then every triangle.
    wide: HashMap<u32, Vec<usize>>,
    all: HashMap<u32, Vec<usize>>,
}

impl<'a> Lookup<'a> {
    pub(super) fn new(
        positions: &'a [f32],
        uvs: &'a [f32],
        live: &'a [u32],
        island: &dyn Fn(u32) -> Option<u32>,
    ) -> Self {
        let triangles = live.len() / 3;
        let area: f64 = (0..triangles)
            .map(|t| {
                let [a, b, c] = uvs_of(uvs, &live[t * 3..t * 3 + 3]);
                ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs() * 0.5
            })
            .filter(|area| area.is_finite())
            .sum();
        let mut lookup = Self {
            positions,
            uvs,
            live,
            cell: (area / triangles as f64).sqrt() * 2.0,
            cells: HashMap::new(),
            wide: HashMap::new(),
            all: HashMap::new(),
        };
        for t in 0..triangles {
            let Some(home) = island(live[t * 3]) else {
                continue;
            };
            lookup.all.entry(home).or_default().push(t);
            let corners = uvs_of(uvs, &live[t * 3..t * 3 + 3]);
            let low = lookup
                .key([0, 1].map(|a| corners.iter().map(|c| c[a]).fold(f64::INFINITY, f64::min)));
            let high = lookup.key([0, 1].map(|a| {
                corners
                    .iter()
                    .map(|c| c[a])
                    .fold(f64::NEG_INFINITY, f64::max)
            }));
            match (low, high) {
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

    /// The largest deviation over the samples of one coarse triangle.
    pub(super) fn triangle(&self, tri: &[u32], island: &dyn Fn(u32) -> Option<u32>) -> f64 {
        let mut homes: Vec<u32> = tri.iter().filter_map(|&v| island(v)).collect();
        homes.sort_unstable();
        homes.dedup();
        let (uvs, spots) = (uvs_of(self.uvs, tri), points_of(self.positions, tri));
        SAMPLES
            .iter()
            .map(|w| {
                let at = [0, 1].map(|a| uvs[0][a] * w[0] + uvs[1][a] * w[1] + uvs[2][a] * w[2]);
                let spot =
                    [0, 1, 2].map(|a| spots[0][a] * w[0] + spots[1][a] * w[1] + spots[2][a] * w[2]);
                self.sample(&homes, at, spot)
            })
            .fold(0.0, f64::max)
    }

    /// Distance from `spot` to the live point of `homes` carrying the coordinate `at`: among the
    /// triangles holding `at`, the nearest; when none holds it, the point of the triangle nearest to
    /// `at` in texture space. Zero for a coordinate that is not a number or no triangle maps.
    fn sample(&self, homes: &[u32], at: [f64; 2], spot: [f64; 3]) -> f64 {
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
        listed
            .flatten()
            .for_each(|&t| self.read(t, at, spot, &mut best));
        if best.0 > 0.0 {
            let every = homes.iter().filter_map(|h| self.all.get(h)).flatten();
            every.for_each(|&t| self.read(t, at, spot, &mut best));
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
        let (ab, ac, ap) = (
            [b[0] - a[0], b[1] - a[1]],
            [c[0] - a[0], c[1] - a[1]],
            [at[0] - a[0], at[1] - a[1]],
        );
        let area = ab[0] * ac[1] - ab[1] * ac[0];
        if !(area.abs() > 0.0 && area.is_finite()) {
            return;
        }
        let (v, w) = (
            (ap[0] * ac[1] - ap[1] * ac[0]) / area,
            (ab[0] * ap[1] - ab[1] * ap[0]) / area,
        );
        let weights = [1.0 - v - w, v, w];
        let inside = weights.iter().all(|&k| k >= INSIDE);
        let clamped = weights.map(|k| k.max(0.0));
        let total: f64 = clamped.iter().sum();
        let weights = clamped.map(|k| k / total);
        let miss = if inside {
            0.0
        } else {
            let on = [0, 1].map(|k| a[k] * weights[0] + b[k] * weights[1] + c[k] * weights[2]);
            length([at[0] - on[0], at[1] - on[1], 0.0])
        };
        if miss > best.0 {
            return;
        }
        let corners = points_of(self.positions, tri);
        let there = [0, 1, 2].map(|k| (0..3).map(|c| corners[c][k] * weights[c]).sum::<f64>());
        let distance = length(sub(spot, there));
        if miss < best.0 || (miss == best.0 && distance < best.1) {
            *best = (miss, distance);
        }
    }
}

/// A triangle's texture coordinates and positions.
fn uvs_of(uvs: &[f32], tri: &[u32]) -> [[f64; 2]; 3] {
    std::array::from_fn(|k| uv(uvs, tri[k]))
}
fn points_of(positions: &[f32], tri: &[u32]) -> [[f64; 3]; 3] {
    std::array::from_fn(|k| point(positions, tri[k]))
}

fn uv(uvs: &[f32], vertex: u32) -> [f64; 2] {
    let at = vertex as usize * 2;
    [uvs[at] as f64, uvs[at + 1] as f64]
}
