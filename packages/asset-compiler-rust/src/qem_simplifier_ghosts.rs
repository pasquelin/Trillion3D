//! The holes a collapse opens: what a collapse taking a piece's shape away leaves uncovered of
//! what other pieces left to it.
//!
//! A collapse costs at most the area it touches (`merge.rs`): a piece goes as cheaply as it is
//! small, whatever goes with it — at once when a collapse takes its last triangles, or a few
//! collapses at a time, each costing the area it touches. Over pieces laid side by side —
//! shingles, boards, leaves — that cost never sees the neighbours: each piece goes at its own
//! size, one next to another, and the surface they made together opens holes far wider than any.
//!
//! **Pieces.** Triangles sharing a position are one piece, and a collapse joins every triangle
//! it gathers. A region of one piece keeps no ghost and lists nothing (`carry.rs`): its own ghosts
//! could never count against it.
//!
//! **Ghosts.** A collapse costing all the area it touches leaves the ghost of every triangle it
//! gathers, as it was before: seven points each (its corners, its edges' middles, its centre),
//! each with the collapse's size — the square root of its cost, hole included, so a hole that
//! grows keeps a ghost as wide as it is — and its piece. A ghost is covered by the live surface
//! (`live.rs`) within its size of it.
//!
//! **The hole.** Such a collapse also costs the square of the largest distance it opens: from a
//! ghost of another piece that the gathered triangles cover — within its size, nearer than any
//! other live triangle — to the live surface as the collapse leaves it, sought up to twice the
//! ghost's size. A piece whose neighbours still cover what went before costs its area, as
//! before; one whose removal uncovers a ghost costs at least the distance it uncovers. A piece's
//! own ghosts never count against it: alone, it still goes at its own size. A hole only ever
//! raises the cost.
//!
//! **Bounds.** A ghost's size falls in a class, a power of two; a class keeps at most one ghost,
//! its largest, per cube of half its least size — a cover's underestimate of at most that cube's
//! diagonal — and finds them by cubes of its largest size, at least half a frame unit: a hole
//! reads, class by class, the cubes within that size of the gathered triangles, or the class's
//! occupied cubes if fewer. Each ghost keeps the live triangle last found covering it, at its
//! stamp: a ghost covered by a triangle outside the collapse within the distance that already
//! settles it costs nothing more; only the ghosts the collapse covers are sought, and the search
//! stops at the first triangle within that distance. Each also keeps what that search found: a
//! collapse weighed reads it while it stands — at most the hole, as a triangle only comes nearer
//! by a move —, one made reads it only when it is still exact, at the current generation.
//!
//! **Levels.** A simplification starts from the ghosts its region's children left and hands its
//! own on (`carry.rs`): a hole is measured against the source surface whatever the level.
use super::live::{Corners, Live, Surface, W};
use super::{NONE, P};
use crate::join::Join;
use trillion3d_page_codec::hash::WordMap;

#[path = "qem_simplifier_carry.rs"]
mod carry;
#[path = "qem_simplifier_hole.rs"]
mod hole;

use hole::{class_keys, ghost_hole, Collapse};

/// A live triangle at `d2`, at its `stamp`.
#[derive(Clone, Copy)]
struct Hit {
    tri: u32,
    stamp: u32,
    d2: f64,
}

/// What the last search past a ghost's covering piece `root` found, at `generation`.
#[derive(Clone, Copy)]
enum Alt {
    Unknown,
    /// A triangle; `full` when the search found the nearest, not merely one within reach.
    Hit {
        hit: Hit,
        root: u32,
        generation: u32,
        full: bool,
    },
    /// Nothing within `d2`.
    Empty {
        root: u32,
        d2: f64,
        generation: u32,
    },
}

struct Ghost {
    p: P,
    size: f32,
    /// A triangle of the piece the ghost was left by; `NONE` once that piece is gone.
    owner: u32,
    witness: Option<Hit>,
    alt: Alt,
}

/// A class's occupied cubes.
struct Class {
    class: i32,
    cubes: Vec<[u32; 4]>,
}

/// The pieces of the region, once a collapse asks.
#[derive(Default)]
enum Pieces {
    #[default]
    Unknown,
    One,
    Many(Join),
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
    pieces: Pieces,
    /// The live triangles, once a ghost is kept.
    live: Option<Live>,
    /// Kept between holes: the cubes read, the gathered triangles before and after.
    keys: Vec<[u32; 4]>,
    before: Vec<(u32, Corners)>,
    after: Vec<Corners>,
}

/// The class of `size`: its power of two.
fn class_of(size: f32) -> i32 {
    ((size.to_bits() >> 23) & 0xff) as i32 - 127
}
/// The side of the cubes a class is found by.
fn cube_side(class: i32) -> f32 {
    2f32.powi(class + 1).max(0.5)
}
fn cube(class: i32, p: P, side: f32) -> [u32; 4] {
    let c = p.map(|x| (x / side).floor() as i32 as u32);
    [class as u32, c[0], c[1], c[2]]
}

impl Ghosts {
    /// Whether a ghost is kept.
    pub fn any(&self) -> bool {
        !self.ghosts.is_empty()
    }

    /// The squared hole a collapse of the gathered triangles `piece`, moving `ends` to `to`,
    /// opens: `floor`, the cost it has without it, unless larger; `made` when the collapse is.
    pub fn hole(
        &mut self,
        surface: &Surface,
        piece: &[usize],
        ends: [P; 2],
        to: P,
        floor: f32,
        made: bool,
    ) -> f32 {
        let Self {
            ghosts,
            cubes,
            classes,
            pieces,
            live,
            keys,
            before,
            after,
            ..
        } = self;
        let (Pieces::Many(join), Some(live)) = (pieces, live.as_ref()) else {
            return floor;
        };
        let collapse = Collapse {
            surface,
            piece,
            own: join.root(piece[0] as u32),
            bounds: surface.bounds(piece),
            ends,
            to,
            made,
        };
        before.clear();
        before.extend(piece.iter().map(|&t| (t as u32, surface.wide(t))));
        let mut listed = false;
        let mut worst = f64::from(floor.max(0.0));
        for class in classes.iter() {
            let reach = f64::from(2f32.powi(class.class + 1));
            if 4.0 * reach * reach <= worst {
                continue;
            }
            class_keys(class, collapse.bounds, keys);
            for id in keys.iter().filter_map(|k| cubes.get(k)).flatten() {
                let g = &mut ghosts[*id as usize];
                let mut ask = |p: W| collapse.after(p, after, &mut listed);
                if let Some(d2) =
                    ghost_hole(g, &collapse, worst, (live, &mut *join), before, &mut ask)
                {
                    worst = d2;
                }
            }
        }
        worst as f32
    }

    /// Leaves the ghost of every triangle of `piece`, gathered by a collapse costing `cost`, as
    /// it is before the collapse moves it; the region holds more than one piece (`carry.rs`).
    pub fn leave(&mut self, surface: &Surface, piece: &[usize], cost: f32) {
        self.live.get_or_insert_with(|| Live::new(surface));
        let size = cost.max(0.0).sqrt();
        for &tri in piece {
            let [a, b, c] = surface.corners(tri);
            let middle = |x: P, y: P| -> P { std::array::from_fn(|k| 0.5 * (x[k] + y[k])) };
            let centre: P = std::array::from_fn(|k| (a[k] + b[k] + c[k]) / 3.0);
            for p in [a, b, c, middle(a, b), middle(b, c), middle(c, a), centre] {
                self.insert(p, size, tri as u32);
            }
        }
    }

    /// Joins the triangles one collapse gathered and lists them where they now lie.
    pub fn moved(&mut self, surface: &Surface, tris: &[usize]) {
        if let Pieces::Many(join) = &mut self.pieces {
            tris.iter()
                .for_each(|&t| join.unite(t as u32, tris[0] as u32));
        }
        if let Some(live) = &mut self.live {
            live.moved(surface, tris);
        }
    }
}
