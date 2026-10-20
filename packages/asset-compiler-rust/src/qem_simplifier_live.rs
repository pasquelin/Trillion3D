//! The live surface the holes are measured against (`ghosts.rs`): the live triangles by the cells
//! of one frame unit their box meets (a few mean triangles, `qem_solve.rs`), a stamp per triangle
//! and a generation for the whole.
//!
//! **Cells.** A moved triangle leaves the cells it was listed in for those it now meets, a
//! removed one leaves them all, and a cell left empty goes: a list never holds more than what
//! lies there, and the cells listed are the cells occupied. Every move stamps the triangle anew
//! and raises the generation: a distance measured to a triangle at an older stamp is stale, and
//! one measured at the current generation is still exact.
//!
//! **Nearest.** The nearest live triangle to a point is sought ring of cells by ring of cells
//! outwards. The search ends once the rings seen reach past the nearest found or past the cap, or
//! once a triangle within the distance that settles the question is met; once the rings left to
//! read hold more cells than are occupied, it reads the occupied cells instead. Its cost follows
//! the distance found, bounded by the occupied cells, never by the extent of the grid.
use super::{ADJ_TRI, NONE, P};
use trillion3d_math::aabb::aabb_of_f32;
use trillion3d_math::triangle::closest_point;
use trillion3d_math::vecn::distance2;
use trillion3d_page_codec::hash::WordMap;

/// A position in double precision, and a triangle's three.
pub(super) type W = [f64; 3];
pub(super) type Corners = [W; 3];

/// The live surface, as the simplifier holds it; `flags` are its corner flags, the gathered
/// triangles of the collapse weighed marked (`ADJ_TRI`).
pub(super) struct Surface<'a> {
    pub verts: &'a [f32],
    pub m: usize,
    pub indexes: &'a [u32],
    pub tri_removed: &'a [bool],
    pub flags: &'a [u8],
}
impl Surface<'_> {
    pub fn corners(&self, tri: usize) -> [P; 3] {
        [0, 1, 2].map(|k| {
            let at = self.indexes[tri * 3 + k] as usize * (3 + self.m);
            [self.verts[at], self.verts[at + 1], self.verts[at + 2]]
        })
    }
    pub fn wide(&self, tri: usize) -> Corners {
        self.corners(tri).map(|p| p.map(f64::from))
    }
    pub fn bounds(&self, tris: &[usize]) -> (P, P) {
        aabb_of_f32(tris.iter().flat_map(|&tri| self.corners(tri)))
    }
    /// Whether the collapse weighed gathers triangle `tri`.
    pub fn gathered(&self, tri: usize) -> bool {
        self.flags[tri * 3] & ADJ_TRI != 0
    }
}

/// The squared distance from `p` to the triangle `abc`.
pub(super) fn distance_to(p: W, [a, b, c]: Corners) -> f64 {
    distance2(closest_point(p, a, b, c), p)
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

fn cells_of([low, high]: [[i32; 3]; 2]) -> impl Iterator<Item = [u32; 3]> {
    (low[0]..=high[0]).flat_map(move |x| {
        (low[1]..=high[1]).flat_map(move |y| (low[2]..=high[2]).map(move |z| key([x, y, z])))
    })
}

/// No cell: the first past the last.
const UNLISTED: [[i32; 3]; 2] = [[0; 3], [-1; 3]];

pub(super) struct Live {
    cells: WordMap<[u32; 3], Vec<u32>>,
    /// The first and last cell of each triangle's box as listed.
    listed: Vec<[[i32; 3]; 2]>,
    /// Each triangle's stamp, raised by every move of it.
    pub stamps: Vec<u32>,
    /// Raised by every collapse made.
    pub generation: u32,
}

impl Live {
    /// Every live triangle of `surface` listed.
    pub fn new(surface: &Surface) -> Self {
        let count = surface.tri_removed.len();
        let mut live = Live {
            cells: WordMap::default(),
            listed: vec![UNLISTED; count],
            stamps: vec![0; count],
            generation: 0,
        };
        for tri in (0..count).filter(|&t| !surface.tri_removed[t]) {
            let (low, high) = surface.bounds(&[tri]);
            live.list(tri, [cell(low), cell(high)]);
        }
        live
    }

    /// Whether triangle `tri` is live and unmoved since `stamp`.
    pub fn current(&self, surface: &Surface, tri: u32, stamp: u32) -> bool {
        !surface.tri_removed[tri as usize] && self.stamps[tri as usize] == stamp
    }

    /// Stamps the triangles of `tris`, gathered by one collapse, and lists each where it now
    /// lies, or nowhere once removed.
    pub fn moved(&mut self, surface: &Surface, tris: &[usize]) {
        self.generation = self.generation.wrapping_add(1);
        for &tri in tris {
            self.stamps[tri] = self.stamps[tri].wrapping_add(1);
            let was = self.listed[tri];
            let now = (!surface.tri_removed[tri]).then(|| {
                let (low, high) = surface.bounds(&[tri]);
                [cell(low), cell(high)]
            });
            if now == Some(was) {
                continue;
            }
            for k in cells_of(was) {
                let Some(list) = self.cells.get_mut(&k) else {
                    continue;
                };
                if let Some(at) = list.iter().position(|&t| t as usize == tri) {
                    list.swap_remove(at);
                }
                if list.is_empty() {
                    self.cells.remove(&k);
                }
            }
            self.listed[tri] = UNLISTED;
            if let Some(now) = now {
                self.list(tri, now);
            }
        }
    }

    fn list(&mut self, tri: usize, box_cells: [[i32; 3]; 2]) {
        for k in cells_of(box_cells) {
            self.cells.entry(k).or_default().push(tri as u32);
        }
        self.listed[tri] = box_cells;
    }

    /// The live triangle `keep` accepts nearest to `p` within `cap2`, and its squared distance,
    /// or the first met within `enough2`; `cap2` and none without one. Ties go to the lower
    /// triangle.
    pub fn nearest(
        &self,
        surface: &Surface,
        p: P,
        enough2: f64,
        cap2: f64,
        mut keep: impl FnMut(usize) -> bool,
    ) -> (f64, u32) {
        let (c, at) = (cell(p), p.map(f64::from));
        let mut best = (cap2, NONE);
        let mut read = |list: &[u32], best: &mut (f64, u32)| -> bool {
            for &tri in list {
                let t = tri as usize;
                if surface.tri_removed[t] || !keep(t) {
                    continue;
                }
                let d2 = distance_to(at, surface.wide(t));
                if d2 < best.0 || (d2 == best.0 && tri < best.1) {
                    *best = (d2, tri);
                    if d2 <= enough2 {
                        return true;
                    }
                }
            }
            false
        };
        for k in 0i32.. {
            if k > 0 {
                // What the rings seen leave out lies at least `seen` away.
                let seen = f64::from(k - 1);
                if best.0 <= seen * seen {
                    break;
                }
                // The rings left within the cap hold more cells than are occupied.
                let left = (2.0 * best.0.sqrt() + 3.0).powi(3) - f64::from(2 * k - 1).powi(3);
                if left > self.cells.len() as f64 {
                    for (occupied, list) in &self.cells {
                        if cell_distance2(at, *occupied) < best.0 && read(list, &mut best) {
                            return best;
                        }
                    }
                    break;
                }
            }
            for near in ring(c, k) {
                if let Some(list) = self.cells.get(&near) {
                    if read(list, &mut best) {
                        return best;
                    }
                }
            }
        }
        best
    }
}

/// The squared distance from `p` to cell `k`.
fn cell_distance2(p: W, k: [u32; 3]) -> f64 {
    (0..3)
        .map(|a| {
            let low = f64::from(k[a] as i32);
            (low - p[a]).max(0.0).max(p[a] - low - 1.0).powi(2)
        })
        .sum()
}
