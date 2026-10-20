//! The holes a collapse opens: what a collapse taking a piece's shape away leaves uncovered of
//! what other pieces left to it.
//!
//! A collapse costs at most the area it touches (`merge.rs`): a piece goes as cheaply as it is
//! small, whatever goes with it — at once when a collapse takes its last triangles, or a few
//! collapses at a time, each costing the area it touches. Over pieces laid side by side —
//! shingles, boards, leaves — that cost never sees the neighbours: each piece goes at its own
//! size, one next to another, and the surface they made together opens holes far wider than any.
//!
//! **Ghosts.** A collapse costing all the area it touches leaves the ghost of every triangle it
//! gathers, as it was before: seven points each (its corners, its edges' middles, its centre),
//! each with the collapse's size — the square root of its cost, hole included, so a hole that
//! grows keeps a ghost as wide as it is — and its piece (`live.rs`). A ghost is covered by the
//! live surface within its size of it.
//!
//! **The hole.** Such a collapse also costs the square of the largest distance it opens: from a
//! ghost of another piece that the gathered triangles cover — within its size, nearer than any
//! other live triangle — to the live surface as the collapse leaves it, sought up to twice the
//! ghost's size. A piece whose neighbours still cover what went before costs its area, as
//! before; one whose removal uncovers a ghost costs at least the distance it uncovers. A piece's
//! own ghosts — those of the triangles it shares a position with — never count against it:
//! alone, it still goes at its own size. A hole only ever raises the cost.
//!
//! **Bounds.** A ghost's size falls in a class, a power of two; a class keeps at most one ghost,
//! its largest, per cube of half its least size — a cover's underestimate of at most that cube's
//! diagonal — and finds them by cubes of its largest size, at least half a frame unit: a hole
//! reads, class by class, the cubes within that size of the gathered triangles, or the class's
//! occupied cubes if fewer. Each ghost keeps the live triangle last found covering it, at its
//! stamp: a ghost covered by a triangle outside the collapse within the distance that already
//! settles it costs nothing more; only the ghosts the collapse covers are sought, and the search
//! stops at the first triangle within that distance.
use super::live::{distance_to, Live, Surface};
use super::{NONE, P};
use trillion3d_page_codec::hash::WordMap;

struct Ghost {
    p: P,
    size: f32,
    /// A triangle of the piece the ghost was left by.
    owner: u32,
    /// A triangle within `d2` of the ghost, at its `stamp`.
    witness: u32,
    stamp: u32,
    d2: f64,
}

/// A class's occupied cubes.
struct Class {
    class: i32,
    cubes: Vec<[u32; 4]>,
}

#[derive(Default)]
pub(super) struct Ghosts {
    ghosts: Vec<Ghost>,
    /// The ghost of each class's cube of half its least size.
    slots: WordMap<[u32; 4], u32>,
    /// The ghosts of each class's cube of its largest size.
    cubes: WordMap<[u32; 4], Vec<u32>>,
    /// The classes present, ascending.
    classes: Vec<Class>,
    /// The live triangles, once a ghost is left.
    live: Option<Live>,
}

/// The class of `size`: its power of two.
fn class_of(size: f32) -> i32 {
    ((size.to_bits() >> 23) & 0xff) as i32 - 127
}
fn two_to(e: i32) -> f32 {
    2f32.powi(e)
}
/// The side of the cubes a class is found by.
fn cube_side(class: i32) -> f32 {
    two_to(class + 1).max(0.5)
}
fn cube(class: i32, p: P, side: f32) -> [u32; 4] {
    let c = p.map(|x| (x / side).floor() as i32 as u32);
    [class as u32, c[0], c[1], c[2]]
}

/// The squared distance from `p` to the box `low..high`.
fn box_distance2(p: P, low: P, high: P) -> f32 {
    (0..3)
        .map(|a| (low[a] - p[a]).max(0.0).max(p[a] - high[a]).powi(2))
        .sum()
}

/// The triangle of `tris` nearest to `p`, and its squared distance.
fn nearest_of(p: P, tris: impl Iterator<Item = (usize, [P; 3])>) -> (f64, u32) {
    tris.map(|(tri, corners)| (distance_to(p, corners), tri as u32))
        .fold((f64::INFINITY, NONE), |a, b| if b.0 < a.0 { b } else { a })
}

impl Ghosts {
    /// Whether a ghost was left.
    pub fn any(&self) -> bool {
        !self.ghosts.is_empty()
    }

    /// The squared hole a collapse of the gathered triangles `piece`, moving `ends` to `to`, opens:
    /// `floor`, the cost it has without it, unless larger.
    pub fn hole(
        &mut self,
        surface: &Surface,
        piece: &[usize],
        (ends, to): ([P; 2], P),
        floor: f32,
    ) -> f32 {
        let Self {
            ghosts,
            cubes,
            classes,
            live,
            ..
        } = self;
        let Some(live) = live.as_mut() else {
            return floor;
        };
        let own = live.piece(piece[0]);
        let (low, high) = surface.bounds(piece);
        // The gathered triangles as the collapse leaves them, the flattened ones gone.
        let moved_to = |p: P| if ends.contains(&p) { to } else { p };
        let moved: Vec<(usize, [P; 3])> = (piece.iter())
            .map(|&tri| (tri, surface.corners(tri).map(moved_to)))
            .filter(|(_, [a, b, c])| a != b && b != c && c != a)
            .collect();
        let mut worst = f64::from(floor.max(0.0));
        for class in classes.iter() {
            let reach = two_to(class.class + 1);
            if 4.0 * f64::from(reach) * f64::from(reach) <= worst {
                continue;
            }
            let side = cube_side(class.class);
            let (first, last) = (low.map(|x| x - reach), high.map(|x| x + reach));
            let (lo, hi) = (
                cube(class.class, first, side),
                cube(class.class, last, side),
            );
            let span = (1..4).fold(1u64, |n, a| {
                n.saturating_mul(u64::from((hi[a] as i32).abs_diff(lo[a] as i32)) + 1)
            });
            let inside = |k: &&[u32; 4]| {
                (1..4).all(|a| (lo[a] as i32..=hi[a] as i32).contains(&(k[a] as i32)))
            };
            let mut keys: Vec<[u32; 4]> = Vec::new();
            if span as usize <= class.cubes.len() {
                for x in lo[1] as i32..=hi[1] as i32 {
                    for y in lo[2] as i32..=hi[2] as i32 {
                        for z in lo[3] as i32..=hi[3] as i32 {
                            keys.push([lo[0], x as u32, y as u32, z as u32]);
                        }
                    }
                }
            } else {
                keys.extend(class.cubes.iter().filter(inside));
            }
            for id in keys.iter().filter_map(|k| cubes.get(k)).flatten() {
                let g = &mut ghosts[*id as usize];
                let (size2, cap2) = (f64::from(g.size).powi(2), 4.0 * f64::from(g.size).powi(2));
                if cap2 <= worst || f64::from(box_distance2(g.p, low, high)) > size2 {
                    continue;
                }
                let held = g.witness != NONE
                    && !surface.tri_removed[g.witness as usize]
                    && live.stamps[g.witness as usize] == g.stamp;
                // The distance to a live triangle outside the gathered ones, as last found.
                let outside = if held && !piece.contains(&(g.witness as usize)) {
                    g.d2
                } else {
                    f64::INFINITY
                };
                if outside <= worst || live.piece(g.owner as usize) == own {
                    continue;
                }
                // Covered by the gathered triangles before, by what is left after.
                let before = nearest_of(g.p, piece.iter().map(|&t| (t, surface.corners(t))));
                if before.0 > size2 {
                    continue;
                }
                if !held || before.0 < g.d2 {
                    let stamp = live.stamps[before.1 as usize];
                    (g.witness, g.stamp, g.d2) = (before.1, stamp, before.0);
                }
                let settled = worst.max(before.0);
                let after = nearest_of(g.p, moved.iter().copied()).0.min(cap2);
                if outside <= settled || after <= settled {
                    continue;
                }
                let found = live.nearest(surface, g.p, piece, (settled, after));
                if found.0 > settled {
                    worst = found.0;
                }
            }
        }
        worst as f32
    }

    /// Leaves the ghost of every triangle of `piece`, gathered by a collapse costing `cost`, as
    /// it is before the collapse moves it.
    pub fn leave(&mut self, surface: &Surface, piece: &[usize], cost: f32) {
        self.live.get_or_insert_with(|| Live::new(surface));
        let size = cost.max(0.0).sqrt();
        if size <= 0.0 || !size.is_finite() {
            return;
        }
        let class = class_of(size);
        let (slot_side, side) = (two_to(class - 1), cube_side(class));
        let at = match self.classes.binary_search_by_key(&class, |c| c.class) {
            Ok(at) => at,
            Err(at) => {
                let cubes = Vec::new();
                self.classes.insert(at, Class { class, cubes });
                at
            }
        };
        for &tri in piece {
            let [a, b, c] = surface.corners(tri);
            let middle = |x: P, y: P| -> P { std::array::from_fn(|k| 0.5 * (x[k] + y[k])) };
            let centre: P = std::array::from_fn(|k| (a[k] + b[k] + c[k]) / 3.0);
            for p in [a, b, c, middle(a, b), middle(b, c), middle(c, a), centre] {
                let ghost = Ghost {
                    p,
                    size,
                    owner: tri as u32,
                    witness: NONE,
                    stamp: 0,
                    d2: 0.0,
                };
                let slot = cube(class, p, slot_side);
                if let Some(&id) = self.slots.get(&slot) {
                    // The slot keeps its largest ghost; a slot lies within one cube.
                    let kept = &mut self.ghosts[id as usize];
                    if size > kept.size {
                        *kept = ghost;
                    }
                    continue;
                }
                let id = self.ghosts.len() as u32;
                self.ghosts.push(ghost);
                self.slots.insert(slot, id);
                let key = cube(class, p, side);
                let list = self.cubes.entry(key).or_default();
                if list.is_empty() {
                    self.classes[at].cubes.push(key);
                }
                list.push(id);
            }
        }
    }

    /// Stamps the triangles one collapse gathered and lists them where they now lie, once the
    /// live triangles are listed.
    pub fn moved(&mut self, surface: &Surface, tris: &[usize]) {
        if let Some(live) = &mut self.live {
            live.moved(surface, tris);
        }
    }
}
