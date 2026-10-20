//! The live surface the holes are measured against (`ghosts.rs`): the live triangles by the cells
//! of one frame unit their box meets (a few mean triangles, `qem_solve.rs`), a stamp per
//! triangle, and the pieces the triangles make.
//!
//! **Cells.** A moved triangle leaves the cells it was listed in for those it now meets, a
//! removed one leaves them all, so a list never holds more than what lies there. Every move
//! stamps the triangle anew: a distance measured to it at an older stamp is stale.
//!
//! **Nearest.** The nearest live triangle to a point is sought ring of cells by ring of cells
//! outwards. The search ends once the rings seen reach past the nearest found or past the cap,
//! once a triangle within the distance that settles the question is met, or once the rings hold
//! every occupied cell: its cost follows the distance found, never the size of the grid.
//!
//! **Pieces.** Triangles sharing a position are one piece, and a collapse joins every triangle
//! it gathers (a union-find, the lower root kept).
use super::{NONE, P};
use trillion3d_math::triangle::closest_point;
use trillion3d_math::vecn::distance2;
use trillion3d_page_codec::hash::WordMap;

/// The live surface, as the simplifier holds it.
pub(super) struct Surface<'a> {
    pub verts: &'a [f32],
    pub m: usize,
    pub indexes: &'a [u32],
    pub tri_removed: &'a [bool],
}
impl Surface<'_> {
    pub fn corners(&self, tri: usize) -> [P; 3] {
        [0, 1, 2].map(|k| {
            let at = self.indexes[tri * 3 + k] as usize * (3 + self.m);
            [self.verts[at], self.verts[at + 1], self.verts[at + 2]]
        })
    }
    pub fn bounds(&self, tris: &[usize]) -> (P, P) {
        let (mut low, mut high) = ([f32::MAX; 3], [-f32::MAX; 3]);
        for &tri in tris {
            for p in self.corners(tri) {
                for a in 0..3 {
                    low[a] = low[a].min(p[a]);
                    high[a] = high[a].max(p[a]);
                }
            }
        }
        (low, high)
    }
}

/// The squared distance from `p` to the triangle `abc`.
pub(super) fn distance_to(p: P, [a, b, c]: [P; 3]) -> f64 {
    let wide = |x: P| x.map(f64::from);
    distance2(closest_point(wide(p), wide(a), wide(b), wide(c)), wide(p))
}

fn cell(p: P) -> [i32; 3] {
    p.map(|x| x.floor() as i32)
}
fn key(c: [i32; 3]) -> [u32; 3] {
    c.map(|v| v as u32)
}

/// The cells at Chebyshev distance `k` from cell `c`.
fn ring(c: [i32; 3], k: i32) -> impl Iterator<Item = [u32; 3]> {
    (-k..=k).flat_map(move |x| {
        (-k..=k).flat_map(move |y| {
            let rim = x.abs() == k || y.abs() == k;
            let step = if rim { 1 } else { 2 * k as usize };
            (-k..=k)
                .step_by(step)
                .map(move |z| key([c[0] + x, c[1] + y, c[2] + z]))
        })
    })
}

pub(super) struct Live {
    cells: WordMap<[u32; 3], Vec<u32>>,
    /// The first and last cell of each triangle's box as listed; none when the first is past
    /// the last.
    listed: Vec<[[i32; 3]; 2]>,
    /// Each triangle's stamp, raised by every move.
    pub stamps: Vec<u32>,
    parents: Vec<u32>,
    /// The first and last cell ever occupied.
    low: [i32; 3],
    high: [i32; 3],
}

impl Live {
    /// Every live triangle of `surface` listed, the triangles sharing a position joined.
    pub fn new(surface: &Surface) -> Self {
        let count = surface.tri_removed.len();
        let mut live = Live {
            cells: WordMap::default(),
            listed: vec![[[0; 3], [-1; 3]]; count],
            stamps: vec![0; count],
            parents: (0..count as u32).collect(),
            low: [i32::MAX; 3],
            high: [i32::MIN; 3],
        };
        let mut first = WordMap::<[u32; 3], u32>::default();
        for tri in (0..count).filter(|&t| !surface.tri_removed[t]) {
            live.list(surface, tri);
            for p in surface.corners(tri) {
                let at = *first
                    .entry(p.map(|x| (x + 0.0).to_bits()))
                    .or_insert(tri as u32);
                live.join(at as usize, tri);
            }
        }
        live
    }

    /// Stamps the triangles of `tris`, gathered by one collapse, lists each where it now lies,
    /// or nowhere once removed, and joins them.
    pub fn moved(&mut self, surface: &Surface, tris: &[usize]) {
        for &tri in tris {
            self.stamps[tri] = self.stamps[tri].wrapping_add(1);
            self.join(tri, tris[0]);
            let [was_low, was_high] = self.listed[tri];
            let removed = surface.tri_removed[tri];
            if !removed {
                let (low, high) = surface.bounds(&[tri]);
                if [cell(low), cell(high)] == [was_low, was_high] {
                    continue;
                }
            }
            for k in Self::cells_of(was_low, was_high) {
                let Some(list) = self.cells.get_mut(&k) else {
                    continue;
                };
                if let Some(at) = list.iter().position(|&t| t as usize == tri) {
                    list.swap_remove(at);
                }
            }
            self.listed[tri] = [[0; 3], [-1; 3]];
            if !removed {
                self.list(surface, tri);
            }
        }
    }

    fn cells_of(low: [i32; 3], high: [i32; 3]) -> impl Iterator<Item = [u32; 3]> {
        (low[0]..=high[0]).flat_map(move |x| {
            (low[1]..=high[1]).flat_map(move |y| (low[2]..=high[2]).map(move |z| key([x, y, z])))
        })
    }

    fn list(&mut self, surface: &Surface, tri: usize) {
        let (low, high) = surface.bounds(&[tri]);
        let (low, high) = (cell(low), cell(high));
        for k in Self::cells_of(low, high) {
            self.cells.entry(k).or_default().push(tri as u32);
        }
        for a in 0..3 {
            self.low[a] = self.low[a].min(low[a]);
            self.high[a] = self.high[a].max(high[a]);
        }
        self.listed[tri] = [low, high];
    }

    /// The piece of triangle `tri`: its root.
    pub fn piece(&mut self, tri: usize) -> u32 {
        let mut t = tri as u32;
        while self.parents[t as usize] != t {
            let up = self.parents[self.parents[t as usize] as usize];
            self.parents[t as usize] = up;
            t = up;
        }
        t
    }

    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.piece(a), self.piece(b));
        self.parents[ra.max(rb) as usize] = ra.min(rb);
    }

    /// The live triangle outside `skip` nearest to `p` within `cap2` and its squared distance, or
    /// the first met within `enough2`; `cap2` and none without one.
    pub fn nearest(
        &self,
        surface: &Surface,
        p: P,
        skip: &[usize],
        (enough2, cap2): (f64, f64),
    ) -> (f64, u32) {
        let c = cell(p);
        let mut best = (cap2, NONE);
        for k in 0.. {
            if k > 0 {
                // What the rings seen leave out lies at least `seen` away, and nothing past them.
                let seen = k - 1;
                let all = (0..3).all(|a| c[a] - seen <= self.low[a] && c[a] + seen >= self.high[a]);
                if best.0 <= f64::from(seen * seen) || all {
                    break;
                }
            }
            for at in ring(c, k) {
                let Some(list) = self.cells.get(&at) else {
                    continue;
                };
                for &tri in list {
                    let t = tri as usize;
                    if surface.tri_removed[t] || skip.contains(&t) {
                        continue;
                    }
                    let d2 = distance_to(p, surface.corners(t));
                    if d2 < best.0 {
                        best = (d2, tri);
                        if d2 <= enough2 {
                            return best;
                        }
                    }
                }
            }
        }
        best
    }
}
