//! The state a strip is laid in: the order a laying follows, the strips laid and the walk across the triangles.

use super::*;

/// How a laying chooses where a strip starts.
#[derive(Clone, Copy)]
pub(super) enum Order<'p> {
    /// Over every triangle still to lay, the corner of the best score, `point` giving each
    /// vertex's place.
    Scored(&'p dyn Fn(u32) -> [f32; 3]),
    /// The order of the triangles: a strip starts at the first not yet laid, and grows only to
    /// the one that follows.
    Given,
}

/// One laying: each triangle in strip order over the vertices laid, in their order, the vertex
/// each laid vertex is, and the code of the strips.
pub(super) struct Lay {
    pub(super) triangles: Vec<[u32; 3]>,
    pub(super) laid: Vec<u32>,
    pub(super) strip: Strip,
}
impl Lay {
    /// The laid triangles over the vertices `source` names of each laid one.
    pub(super) fn flat(&self, source: &dyn Fn(u32) -> u32) -> Vec<u32> {
        (self.triangles.iter().flatten())
            .map(|&laid| source(self.laid[laid as usize]))
            .collect()
    }
}

/// The state of one laying: each vertex's laid index (`NONE` once out of reach), each laid
/// vertex's vertex, the triangles still to lay, the laid triangles, the code so far.
pub(super) struct Laying<'t> {
    pub(super) corners: &'t [u32],
    pub(super) opposite: &'t [u32],
    pub(super) laid_of: Vec<u32>,
    pub(super) laid: Vec<u32>,
    pub(super) enabled: Vec<bool>,
    pub(super) triangles: Vec<[u32; 3]>,
    pub(super) strip: Strip,
}

impl Laying<'_> {
    /// Whether the triangle of corner `c`, a corner or `NONE`, is still to lay.
    pub(super) fn open(&self, c: u32) -> bool {
        c != NONE && self.enabled[(c / 3) as usize]
    }
    /// Whether triangle `t` has three corners that are three vertices: a strip grows neither to
    /// nor from one that names a vertex twice, the code having no place for it.
    pub(super) fn proper(&self, t: usize) -> bool {
        let [a, b, c] = [0, 1, 2].map(|k| self.corners[t * 3 + k]);
        a != b && b != c && a != c
    }
    /// The laid indices the three vertices of `old` would take, the window's evictions made:
    /// `NONE` for one laid anew.
    pub(super) fn reach(&self, old: [u32; 3]) -> [u32; 3] {
        let mut new = old.map(|v| self.laid_of[v as usize]);
        let mut next = self.laid.len() as u32 + new.iter().filter(|&&n| n == NONE).count() as u32;
        'evict: loop {
            for slot in &mut new {
                if *slot != NONE && next - *slot >= WINDOW {
                    *slot = NONE;
                    next += 1;
                    continue 'evict;
                }
            }
            break;
        }
        new
    }
    /// The window's score of triangle `t`'s vertices (`WEIGHTS`, row `case`).
    pub(super) fn score(&self, t: usize, case: usize) -> i32 {
        let count = self.laid.len() as u32;
        (self.corners[t * 3..t * 3 + 3].iter())
            .map(|&v| match self.laid_of[v as usize] {
                NONE => 0,
                laid => {
                    let back = (count - 1) - laid;
                    WEIGHTS[case].get(back as usize).copied().unwrap_or(0)
                }
            })
            .sum()
    }
    /// Whether triangle `t`'s three vertices all lie past the window, never laid or laid more than
    /// `WINDOW` back: from any corner, `reach` lays each anew and `score` weighs each 0.
    pub(super) fn cold(&self, t: usize) -> bool {
        let count = self.laid.len() as u32;
        (self.corners[t * 3..t * 3 + 3].iter()).all(|&v| match self.laid_of[v as usize] {
            NONE => true,
            laid => count - laid > WINDOW,
        })
    }
    /// The score of the triangle of corner `c` entered from a strip — across its own edge
    /// (`opposite`) when `across` — by its neighbours across the edges of the corners after and
    /// before `c`.
    pub(super) fn grown_score(&self, c: u32, across: bool) -> i32 {
        let left = self.open(self.opposite[next(c) as usize]);
        let right = self.open(self.opposite[prev(c) as usize]);
        self.score((c / 3) as usize, row(false, across, left, right))
    }
    /// Lays the triangle of corner `c`, from its corner after `c` — from its corner before `c`
    /// when grown across the edge of the corner after the last one (`!right`, not `start`) — and
    /// writes its code: the bits, and the distance of each vertex it names.
    pub(super) fn visit(&mut self, c: u32, start: bool, right: bool) {
        let old = [next(c), prev(c), c].map(|k| self.corners[k as usize]);
        let mut new = self.reach(old);
        let fresh = new.iter().filter(|&&n| n == NONE).count();
        let t = self.triangles.len();
        let (word, bit) = (t / PER_WORD, 1u32 << (t % PER_WORD));
        if word == self.strip.masks.len() {
            self.strip.masks.push([0; 3]);
        }
        // How far back each vertex named lies from the last one laid before this triangle.
        let back = |laid: u32| (self.laid.len() as u32).wrapping_sub(1).wrapping_sub(laid);
        if start {
            let named = 3 - fresh as u32;
            let mask = &mut self.strip.masks[word];
            mask[0] |= bit;
            if named & 2 != 0 {
                mask[1] |= bit;
            }
            if named & 1 != 0 {
                mask[2] |= bit;
            }
            for &laid in &new[..named as usize] {
                let distance = back(laid);
                self.strip.refs.push(distance);
            }
        } else {
            let mask = &mut self.strip.masks[word];
            if !right {
                mask[1] |= bit;
            }
            if new[2] != NONE {
                mask[2] |= bit;
                let distance = back(new[2]);
                self.strip.refs.push(distance);
            }
        }
        for (slot, &v) in new.iter_mut().zip(&old) {
            if *slot == NONE {
                *slot = self.laid.len() as u32;
                self.laid.push(v);
            }
            self.laid_of[v as usize] = *slot;
        }
        self.triangles.push(match start || right {
            true => new,
            false => [new[1], new[2], new[0]],
        });
        self.enabled[(c / 3) as usize] = false;
    }
}
