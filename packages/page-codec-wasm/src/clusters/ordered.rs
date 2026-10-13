//! The ordered rule: index ranges of consecutive triangles, each within the caps. A vertex is marked
//! with the number of the cluster that last took it: no set per triangle. Bit for bit the scan the
//! run-time cut ran in TypeScript before it came here: every float operation in the same order on
//! the same doubles, `Math.min`/`Math.max` as `js_min`/`js_max`.
use super::{point, Caps};
use trillion3d_math::aabb::EMPTY_FLAT;
use trillion3d_math::js::{js_max, js_min};
use trillion3d_math::triangle::triangle_area;
use trillion3d_math::vec3::{length, sub};
use trillion3d_math::vecn::distance2;

/// The squared diagonal of the least box that holds `triangles` triangles of total area
/// `triangles · area / count` side by side, the longest of them `longest` across: a square of that
/// area, or a rectangle `longest` long when one triangle outreaches the square's side.
fn compact_squared(triangles: usize, count: f64, area: f64, longest: f64) -> f64 {
    let held = (triangles as f64 * area) / count;
    let side = js_max(longest, held.sqrt());
    if side == 0.0 || side.is_nan() {
        return 0.0;
    }
    let other = held / side;
    side * side + other * other
}

/// A run of consecutive triangles: its box, its triangles' area, their longest edge.
struct Run<'a> {
    positions: &'a [f32],
    triangles: usize,
    bounds: [f64; 6],
    grown: [f64; 6],
    count: f64,
    area: f64,
    longest: f64,
    next_area: f64,
    next_longest: f64,
}

impl Run<'_> {
    /// The area and longest edge of `(a, b, c)`, and the run's box grown by it. A length is the
    /// plain root (`vec3::length`): squares of coordinates read from 32-bit floats never leave the
    /// normal range.
    fn measure(&mut self, a: u32, b: u32, c: u32) {
        let [pa, pb, pc] = [a, b, c].map(|v| point(self.positions, v));
        self.next_area = triangle_area(pa, pb, pc);
        let edge = |u: [f64; 3], v: [f64; 3]| length(sub(v, u));
        self.next_longest = js_max(js_max(edge(pa, pb), edge(pb, pc)), edge(pc, pa));
        self.grown = self.bounds;
        for p in [pa, pb, pc] {
            for (k, &x) in p.iter().enumerate() {
                self.grown[k] = js_min(self.grown[k], x);
                self.grown[3 + k] = js_max(self.grown[3 + k], x);
            }
        }
    }

    /// Adds `(a, b, c)` while the run reaches no farther than a compact cluster of its triangles,
    /// else, or when `fresh`, as the first of a new run. True when it starts a new run.
    fn add(&mut self, a: u32, b: u32, c: u32, mut fresh: bool) -> bool {
        if !fresh {
            self.measure(a, b, c);
            let g = self.grown;
            let diagonal = distance2([g[3], g[4], g[5]], [g[0], g[1], g[2]]);
            let longest = js_max(self.longest, self.next_longest);
            let compact = compact_squared(
                self.triangles,
                self.count + 1.0,
                self.area + self.next_area,
                longest,
            );
            fresh = diagonal > compact;
        }
        if fresh {
            (self.count, self.area, self.longest) = (0.0, 0.0, 0.0);
            self.bounds = EMPTY_FLAT;
            self.measure(a, b, c);
        }
        self.bounds = self.grown;
        self.count += 1.0;
        self.area += self.next_area;
        self.longest = js_max(self.longest, self.next_longest);
        fresh
    }
}

/// Index ranges `[start, end)` of consecutive triangles of `indices` (over `vertex_count` vertices),
/// each within `caps`. With `compact_at`, the positions of held faces whose triangles keep their
/// order, a range also ends where its next triangle would take its box past the diagonal of a
/// compact cluster of its triangles: cut in order, its pages never reach farther than compact ones.
pub fn ordered(
    indices: &[u32],
    vertex_count: usize,
    compact_at: Option<&[f32]>,
    caps: Caps,
) -> Vec<[usize; 2]> {
    let mut taken = vec![0u32; vertex_count];
    let mut run = compact_at.map(|positions| Run {
        positions,
        triangles: caps.triangles,
        bounds: [0.0; 6],
        grown: [0.0; 6],
        count: 0.0,
        area: 0.0,
        longest: 0.0,
        next_area: 0.0,
        next_longest: 0.0,
    });
    let (mut ranges, mut start, mut cluster, mut held) = (Vec::new(), 0usize, 1u32, 0usize);
    let mut t = 0;
    while t + 2 < indices.len() {
        let [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
        let other = |v: u32| taken.get(v as usize) != Some(&cluster);
        let fresh = other(a) as usize
            + (other(b) && b != a) as usize
            + (other(c) && c != a && c != b) as usize;
        let full = (t - start) / 3 >= caps.triangles;
        let ends = full || held + fresh > caps.vertices;
        let cut = match run.as_mut() {
            Some(run) => run.add(a, b, c, ends || t == start),
            None => ends,
        };
        if cut && t > start {
            ranges.push([start, t]);
            (start, cluster, held) = (t, cluster + 1, 0);
        }
        // A vertex past the array is never marked, so it counts at each of its corners.
        for v in [a, b, c] {
            match taken.get_mut(v as usize) {
                Some(mark) if *mark == cluster => {}
                Some(mark) => (*mark, held) = (cluster, held + 1),
                None => held += 1,
            }
        }
        t += 3;
    }
    if start < indices.len() {
        ranges.push([start, indices.len()]);
    }
    ranges
}
