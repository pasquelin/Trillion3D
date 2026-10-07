//! The sampled Hausdorff distance raised to a floor the caller already holds: a sample stops
//! at the first triangle within the floor, so only the samples that can raise the result are
//! measured exactly, and the result is the full measure's raised to the floor, bit for bit.
use super::{at, lerp, Grid, P};
use rayon::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

/// A floor raised to every value a parallel search returns. A value at or below the floor cannot
/// raise the search's maximum, so a query may stop there; a value above it is measured exactly and
/// raises it. Every value the floor takes is the caller's or a returned one, so the maximum raised
/// to the caller's floor is the fixed floor's, bit for bit. A negative floor, or one that is not a
/// number, starts at zero.
struct RunningFloor(AtomicU64);

impl RunningFloor {
    fn new(floor: f64) -> Self {
        // Non-negative floats order as their bits: `fetch_max` on the bits is the float maximum.
        Self(AtomicU64::new(
            if floor > 0.0 { floor } else { 0.0 }.to_bits(),
        ))
    }
    fn get(&self) -> f64 {
        f64::from_bits(self.0.load(Relaxed))
    }
    /// Raises the floor to `value`; a NaN sorts above every number and then stops no query.
    fn raise(&self, value: f64) -> f64 {
        // The floor only rises: a value at or below it skips the shared write.
        if value.to_bits() > self.0.load(Relaxed) {
            self.0.fetch_max(value.to_bits(), Relaxed);
        }
        value
    }
}

/// Every sample of `from`'s triangles once: its vertices, its edge midpoints and its centroids.
/// An edge's midpoint is its triangles' `lerp`, taken in each direction they list it, both kept
/// only when the two round apart: the same points as seven per triangle, so the same maximum.
fn distinct_samples(pos: &[f32], from: &[u32]) -> Vec<P> {
    let mut vertices = from.to_vec();
    vertices.par_sort_unstable();
    vertices.dedup();
    let triangles = from.as_chunks::<3>().0;
    let mut edges: Vec<(u32, u32, bool)> = triangles
        .iter()
        .flat_map(|&[a, b, c]| [(a, b), (b, c), (c, a)])
        .map(|(i, j)| (i.min(j), i.max(j), i > j))
        .collect();
    edges.par_sort_unstable();
    edges.dedup();
    let mut points: Vec<P> = Vec::with_capacity(vertices.len() + edges.len() + triangles.len());
    points.extend(vertices.iter().map(|&v| at(pos, v)));
    for (k, &(i, j, reversed)) in edges.iter().enumerate() {
        let (a, b) = (at(pos, i), at(pos, j));
        let forward = lerp(a, b, 0.5);
        if !reversed {
            points.push(forward);
            continue;
        }
        let backward = lerp(b, a, 0.5);
        if k == 0
            || edges[k - 1] != (i, j, false)
            || backward.map(f64::to_bits) != forward.map(f64::to_bits)
        {
            points.push(backward);
        }
    }
    points.extend(triangles.iter().map(|tri| {
        let [a, b, c] = tri.map(|v| at(pos, v));
        [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) / 3.0)
    }));
    points
}

/// Largest distance from the samples of `from` to the triangles of `to`, exact above `floor`, the
/// floor raised to each distance found ([`RunningFloor`]).
pub(super) fn one_sided(pos: &[f32], from: &[u32], to: &Grid, floor: f64) -> f64 {
    let running = RunningFloor::new(floor);
    distinct_samples(pos, from)
        .into_par_iter()
        .map(|p| running.raise(to.nearest(p, running.get())))
        .reduce(|| 0.0, f64::max)
}

/// `floor` raised to a distance, a zero result always `+0`: `f64::max` leaves the sign of a zero
/// between `-0` and `+0` unspecified (arm64's `fmaxnm` returns `+0`, x86's `maxsd` the second
/// operand), and a `-0` floor would publish a platform's zero. A distance is never `-0`.
fn raised(floor: f64, distance: f64) -> f64 {
    floor.max(distance) + 0.0
}

/// `floor.max(distance(pos, a, b))`, bit for bit, at a fraction of its cost, a zero as `+0`; the
/// floor raised to `0` when either side is empty.
pub(crate) fn distance_above(pos: &[f32], a: &[u32], b: &[u32], floor: f64) -> f64 {
    if a.is_empty() || b.is_empty() {
        return raised(floor, 0.0);
    }
    // The first side raises the floor of the second: a sample below it cannot change the max.
    // The second side's grid does not read the floor: it is built while the first side runs.
    let (first, grid_a) = rayon::join(
        || one_sided(pos, a, &Grid::new(pos, b), floor),
        || Grid::new(pos, a),
    );
    let floor = floor.max(first);
    raised(floor, one_sided(pos, b, &grid_a, floor))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The samples of one triangle as the serial measure takes them: corners, edge midpoints,
    /// centroid.
    fn samples(pos: &[f32], tri: &[u32]) -> [P; 7] {
        let [a, b, c] = [0, 1, 2].map(|k| at(pos, tri[k]));
        let centroid = [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) / 3.0);
        let middles = [lerp(a, b, 0.5), lerp(b, c, 0.5), lerp(c, a, 0.5)];
        [a, b, c, middles[0], middles[1], middles[2], centroid]
    }

    #[test]
    fn a_running_floor_returns_every_sample_against_every_triangle_bit_for_bit() {
        let mut rng = crate::tests::random::Xorshift::new(0x977);
        for case in 0..40 {
            let pos: Vec<f32> = (0..90).map(|_| rng.unit() * 10.0).collect();
            let mut pick =
                |n: usize| -> Vec<u32> { (0..n * 3).map(|_| rng.below(30) as u32).collect() };
            let (from, to) = (pick(1 + case % 12), pick(1 + case % 7));
            let grid = Grid::new(&pos, &to);
            let exact = from
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|tri| samples(&pos, tri))
                .map(|p| grid.brute(p))
                .fold(0.0, f64::max);
            for floor in [
                0.0,
                -0.0,
                -1.0,
                exact * 0.5,
                exact,
                exact * 2.0,
                f64::INFINITY,
                f64::NAN,
            ] {
                let measured = floor.max(one_sided(&pos, &from, &grid, floor));
                assert_eq!(
                    measured.to_bits(),
                    floor.max(exact).to_bits(),
                    "case {case}, floor {floor}"
                );
            }
        }
    }
}
