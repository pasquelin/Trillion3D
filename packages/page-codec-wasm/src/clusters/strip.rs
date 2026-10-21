//! The strips a cluster's triangles are laid in at encode, and the halving of a cluster whose
//! strips lay more vertices than a page holds (`constrained`).
//!
//! **The window.** A strip names a vertex it reuses by how far back among the vertices laid so far
//! it was laid, `WINDOW − 1` at most: a vertex further back is laid again, so a vertex can be laid
//! twice and the vertices laid can outnumber the cluster's.
//!
//! **Laying** (`lay`). A triangle's neighbour across an edge is a triangle running that edge back
//! between the same two vertices, the last listed first. A strip starts, over every triangle still
//! to lay in index order and its three corners in order, at the corner whose vertices — the
//! corner after it, the corner before it, then the corner itself — would lay new vertices only at
//! the end, of the best score: the window's score of the triangle's three vertices (`WEIGHTS`, by
//! whether the triangle starts a strip, whether its neighbours across the corner's three edges are
//! still to lay, and how far back each vertex lies), a tie going to the greater sum of the
//! corners' x than the last tie kept. The strip then grows to the neighbour across the edge of the
//! corner after its last corner, or across the edge of the corner before it when that one is still
//! to lay and scores more, until neither is left, the triangles laid reach a multiple of 32, or the
//! two vertices it shares would leave the window. A laid triangle starts at the corner after its
//! entry corner, or, grown across the edge of the corner after the last one, at the corner before
//! its entry: its winding kept.
//!
//! **The cap.** A cluster whose strips lay more vertices than the cap is cut after the first half
//! of its laid triangles, and each half is laid again as the first laying named it, a vertex laid
//! twice there two vertices.
use crate::edges::DirectedEdges;
use crate::encode::vertices::first_use;
use trillion3d_math::geometry::triangle::{next_corner as next, prev_corner as prev};
use trillion3d_math::vector::vec3::point_checked_f32;

mod weights;

use weights::{row, WEIGHTS};

/// How far back, in laid vertices, a strip names a vertex it reuses, plus one.
const WINDOW: u32 = 32;
/// No vertex laid, no corner.
const NONE: u32 = 0xFFFF;
/// The triangles a strip runs at most before it starts again: the laid count's period.
const RUN: usize = 32;

/// A cluster laid in strips: its triangles in strip order, and, its strips laying more vertices
/// than the cap, its second half laid on its own.
pub struct Laid {
    pub first: Vec<u32>,
    pub second: Option<Vec<u32>>,
}

/// The triangles of `cluster` over `positions` laid in strips, halved when they lay more vertices
/// than `cap` (the module's rule).
pub fn constrained(positions: &[f32], cluster: &[u32], cap: usize) -> Laid {
    let point = |v: u32| point_checked_f32(positions, v as usize).unwrap_or([f32::NAN; 3]);
    let triangles = cluster.as_chunks::<3>().0;
    let whole = lay(triangles, &point);
    let itself = |v: u32| v;
    if whole.laid.len() <= cap {
        return Laid {
            first: whole.flat(&itself),
            second: None,
        };
    }
    let source = |laid: u32| whole.laid[laid as usize];
    let point_of = |laid: u32| point(source(laid));
    let half = triangles.len() / 2;
    let first = lay(&whole.triangles[..half], &point_of);
    let second = lay(&whole.triangles[half..], &point_of);
    Laid {
        first: first.flat(&source),
        second: Some(second.flat(&source)),
    }
}

/// One laying: each triangle in strip order over the vertices laid, in their order, and the
/// vertex each laid vertex is.
struct Lay {
    triangles: Vec<[u32; 3]>,
    laid: Vec<u32>,
}
impl Lay {
    /// The laid triangles over the vertices `source` names of each laid one.
    fn flat(&self, source: &dyn Fn(u32) -> u32) -> Vec<u32> {
        (self.triangles.iter().flatten())
            .map(|&laid| source(self.laid[laid as usize]))
            .collect()
    }
}

/// The state of one laying: each vertex's laid index (`NONE` once out of reach), each laid
/// vertex's vertex, the triangles still to lay, the laid triangles.
struct Laying<'t> {
    corners: &'t [u32],
    opposite: &'t [u32],
    laid_of: Vec<u32>,
    laid: Vec<u32>,
    enabled: Vec<bool>,
    triangles: Vec<[u32; 3]>,
}

impl Laying<'_> {
    /// Whether the triangle of corner `c`, a corner or `NONE`, is still to lay.
    fn open(&self, c: u32) -> bool {
        c != NONE && self.enabled[(c / 3) as usize]
    }
    /// The laid indices the three vertices of `old` would take, the window's evictions made:
    /// `NONE` for one laid anew.
    fn reach(&self, old: [u32; 3]) -> [u32; 3] {
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
    fn score(&self, t: usize, case: usize) -> i32 {
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
    fn cold(&self, t: usize) -> bool {
        let count = self.laid.len() as u32;
        (self.corners[t * 3..t * 3 + 3].iter()).all(|&v| match self.laid_of[v as usize] {
            NONE => true,
            laid => count - laid > WINDOW,
        })
    }
    /// The score of the triangle of corner `c` entered from a strip — across its own edge
    /// (`opposite`) when `across` — by its neighbours across the edges of the corners after and
    /// before `c`.
    fn grown_score(&self, c: u32, across: bool) -> i32 {
        let left = self.open(self.opposite[next(c) as usize]);
        let right = self.open(self.opposite[prev(c) as usize]);
        self.score((c / 3) as usize, row(false, across, left, right))
    }
    /// Lays the triangle of corner `c`, from its corner after `c` — from its corner before `c`
    /// when grown across the edge of the corner after the last one (`!right`, not `start`).
    fn visit(&mut self, c: u32, start: bool, right: bool) {
        let old = [next(c), prev(c), c].map(|k| self.corners[k as usize]);
        let mut new = self.reach(old);
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

/// `triangles` over vertices named by any number laid in strips (the module's rule), `point`
/// each vertex's position.
fn lay(triangles: &[[u32; 3]], point: &dyn Fn(u32) -> [f32; 3]) -> Lay {
    let n = triangles.len();
    let (vertices, corners) = first_use(triangles.as_flattened().iter().copied());
    let priorities: Vec<f32> = (corners.as_chunks::<3>().0.iter())
        .map(|tri| {
            let [a, b, c] = tri.map(|v| point(vertices[v as usize]));
            a[0] + b[0] + c[0]
        })
        .collect();
    // Each corner's neighbour across its own edge: the last listed corner of a triangle running
    // that edge back, each taken once. Only the corners of one edge take from the run going the
    // other way, in order, each the next from that run's end.
    let edges = DirectedEdges::of(
        (0..corners.len() as u32)
            .map(|c| (corners[next(c) as usize], corners[prev(c) as usize], c))
            .collect(),
        |edges| edges.sort_unstable(),
    );
    let mut opposite = vec![NONE; n * 3];
    for run in 0..edges.runs() {
        if let Some(back) = edges.back(run) {
            let taken = edges.run(back).iter().rev();
            for (&(_, _, c), &(_, _, o)) in edges.run(run).iter().zip(taken) {
                opposite[c as usize] = o;
            }
        }
    }
    let mut state = Laying {
        corners: &corners,
        opposite: &opposite,
        laid_of: vec![NONE; vertices.len()],
        laid: Vec::new(),
        enabled: vec![true; n],
        triangles: Vec::with_capacity(n),
    };
    loop {
        let (mut start, mut best, mut best_priority) = (NONE, -1i32, i32::MIN as f32);
        for t in (0..n).filter(|&t| state.enabled[t]) {
            // A triangle past the window lays new vertices only and scores 0, from any corner.
            let cold = state.cold(t);
            for k in 0..3u32 {
                let c = t as u32 * 3 + k;
                let score = if cold {
                    0
                } else {
                    let new = state.reach([next(c), prev(c), c].map(|k| corners[k as usize]));
                    let mask = (0..3).fold(0u32, |m, i| m | u32::from(new[i] == NONE) << i);
                    if !matches!(mask, 0 | 4 | 6 | 7) {
                        continue;
                    }
                    let case = row(
                        true,
                        state.open(opposite[c as usize]),
                        state.open(opposite[next(c) as usize]),
                        state.open(opposite[prev(c) as usize]),
                    );
                    state.score(t, case)
                };
                if score > best {
                    (start, best) = (c, score);
                } else if score == best && priorities[t] > best_priority {
                    (start, best_priority) = (c, priorities[t]);
                }
            }
        }
        if start == NONE {
            break;
        }
        state.visit(start, true, false);
        let mut current = start;
        while state.triangles.len() % RUN != 0 {
            let (left, right) = (
                opposite[next(current) as usize],
                opposite[prev(current) as usize],
            );
            let mut chosen = None;
            let mut left_score = i32::MIN;
            if state.open(left) {
                left_score = state.grown_score(left, true);
                chosen = Some((left, false));
            }
            if state.open(right) && state.grown_score(right, false) > left_score {
                chosen = Some((right, true));
            }
            let Some((corner, is_right)) = chosen else {
                break;
            };
            let count = state.laid.len() as u32;
            let [n0, n1, n2] = [next(corner), prev(corner), corner]
                .map(|k| state.laid_of[corners[k as usize] as usize]);
            let fresh = n2 == NONE || count.wrapping_sub(n2) >= WINDOW;
            let after = count + u32::from(fresh);
            if after.wrapping_sub(n0) >= WINDOW || after.wrapping_sub(n1) >= WINDOW {
                break;
            }
            state.visit(corner, false, is_right);
            current = corner;
        }
    }
    Lay {
        triangles: state.triangles,
        laid: (state.laid.iter()).map(|&v| vertices[v as usize]).collect(),
    }
}
