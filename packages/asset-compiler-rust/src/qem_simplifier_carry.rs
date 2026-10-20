//! The ghosts that cross levels (`ghosts.rs`): those a group's simplification starts from, left
//! by the simplifications of its children, and those it hands on to its parent's; the slot every
//! ghost takes, carried in or left (`insert`); and the region's pieces, found once a collapse or
//! a carried ghost asks.
//!
//! A level simplifies its regions afresh: without them, a piece that survived the level below
//! goes at its own size although what the level below removed beside it relied on it, and the
//! holes grow from level to level while each level's error stays the same. Carried, a ghost is
//! where the source surface was, whatever the level, and a hole is measured against it.
//!
//! **One piece.** A region whose triangles all share positions, one way or another, is one piece:
//! it keeps no ghost, carried or left, and lists no live triangle — a connected mesh costs
//! nothing more and simplifies as it would without ghosts.
//!
//! **Handing on.** Every ghost whose size, twice over, is above the error its group publishes —
//! a hole is sought up to twice a ghost's size, and the parent publishes no less — goes on, in
//! object space, with the vertex nearest it of a live triangle covering it within its size, if
//! one does (the one it keeps, else the first met), and the vertex nearest it of its piece:
//! of the cover when the cover is of its piece, else of the piece's nearest triangle within
//! twice its size, else of any. A ghost whose piece is gone goes without. Positions cross levels
//! exactly: a frame is a power of two, and a kept vertex keeps its floats.
//!
//! **Starting from them.** A ghost carried in takes the slot it falls in, its piece that of the
//! live triangle at its piece's vertex; a ghost whose piece's vertex is not in the region is
//! dropped, never left without a piece.
use super::super::live::Surface;
use super::super::Simplifier;
use super::{class_of, cube, cube_side};
use super::{Alt, Class, Ghost, Ghosts, Hit, Live, Pieces, NONE, P};
use crate::join::Join;
use crate::qem::solve::CarriedGhost;
use trillion3d_page_codec::hash::WordMap;

/// The corner of triangle `tri` nearest to `p`.
fn nearest_corner(surface: &Surface, tri: u32, p: P) -> P {
    let d2 = |c: &P| (0..3).map(|a| (c[a] - p[a]).powi(2)).sum::<f32>();
    let corners = surface.corners(tri as usize);
    corners
        .into_iter()
        .fold(corners[0], |a, b| if d2(&b) < d2(&a) { b } else { a })
}

impl Ghosts {
    /// Keeps the ghosts of `carried`, in object space, scaled by `scale` into the frame; `at`
    /// finds the live triangle at a position.
    fn seed(
        &mut self,
        surface: &Surface,
        carried: &[CarriedGhost],
        scale: f32,
        at: impl Fn(P) -> Option<u32>,
    ) {
        let frame = |p: P| p.map(|x| x * scale);
        for g in carried {
            let owner = match g.owner {
                None => NONE,
                Some(owner) => match at(frame(owner)) {
                    Some(tri) => tri,
                    None => continue,
                },
            };
            self.live.get_or_insert_with(|| Live::new(surface));
            self.insert(frame(g.p), g.size * scale, owner);
        }
    }

    /// The ghosts to hand on, in object space by `inverse`, those twice above `least` in size.
    fn carried(&mut self, surface: &Surface, least: f32, inverse: f32) -> Vec<CarriedGhost> {
        let Self {
            ghosts,
            pieces,
            live,
            ..
        } = self;
        let (Pieces::Many(join), Some(live)) = (pieces, live.as_ref()) else {
            return Vec::new();
        };
        // A live triangle of each piece, by its root, listed the first time a far piece asks.
        let mut any: Option<WordMap<u32, u32>> = None;
        let back = |p: P| p.map(|x| x * inverse);
        let mut out = Vec::new();
        for g in ghosts.iter().filter(|g| 2.0 * g.size > least) {
            let size2 = f64::from(g.size * g.size);
            let current = |h: &Hit| live.current(surface, h.tri, h.stamp) && h.d2 <= size2;
            let alt = match g.alt {
                Alt::Hit { hit, .. } => Some(hit),
                _ => None,
            };
            let cover = (g
                .witness
                .filter(current)
                .or(alt.filter(current))
                .map(|h| h.tri))
            .or_else(|| Some(live.nearest(surface, g.p, size2, size2, |_| true).1))
            .filter(|&tri| tri != NONE);
            let owner = (g.owner != NONE)
                .then(|| join.root(g.owner))
                .and_then(|root| {
                    let mine = |t: u32, join: &mut Join| join.root(t) == root;
                    cover.filter(|&t| mine(t, join)).or_else(|| {
                        let keep = |t: usize| mine(t as u32, join);
                        let (_, tri) = live.nearest(surface, g.p, 0.0, 4.0 * size2, keep);
                        (tri != NONE).then_some(tri).or_else(|| {
                            let any = any.get_or_insert_with(|| {
                                let live_tris = (0..surface.tri_removed.len() as u32)
                                    .filter(|&t| !surface.tri_removed[t as usize]);
                                let mut by_root = WordMap::default();
                                for t in live_tris {
                                    by_root.entry(join.root(t)).or_insert(t);
                                }
                                by_root
                            });
                            any.get(&root).copied()
                        })
                    })
                });
            out.push(CarriedGhost {
                p: back(g.p),
                size: g.size * inverse,
                owner: owner.map(|t| back(nearest_corner(surface, t, g.p))),
                cover: cover.map(|t| back(nearest_corner(surface, t, g.p))),
            });
        }
        out
    }

    /// Keeps a ghost at `p` of `size` left by the piece of triangle `owner` (`NONE` for none),
    /// unless its slot keeps a larger one.
    pub(super) fn insert(&mut self, p: P, size: f32, owner: u32) {
        if size <= 0.0 || !size.is_finite() {
            return;
        }
        let class = class_of(size);
        let ghost = Ghost {
            p,
            size,
            owner,
            witness: None,
            alt: Alt::Unknown,
        };
        let slot = cube(class, p, 2f32.powi(class - 1));
        if let Some(&id) = self.slots.get(&slot) {
            // The slot keeps its largest ghost; a slot lies within one cube.
            let kept = &mut self.ghosts[id as usize];
            if size > kept.size {
                *kept = ghost;
            }
            return;
        }
        let at = match self.classes.binary_search_by_key(&class, |c| c.class) {
            Ok(at) => at,
            Err(at) => {
                let cubes = Vec::new();
                self.classes.insert(at, Class { class, cubes });
                at
            }
        };
        let id = self.ghosts.len() as u32;
        self.ghosts.push(ghost);
        self.slots.insert(slot, id);
        let key = cube(class, p, cube_side(class));
        let list = self.cubes.entry(key).or_default();
        if list.is_empty() {
            self.classes[at].cubes.push(key);
        }
        list.push(id);
    }
}

impl Simplifier {
    /// Whether the region holds more than one piece: its triangles joined through the positions
    /// they share, the first time it is asked.
    fn many_pieces(&mut self) -> bool {
        if matches!(self.ghosts.pieces, Pieces::Unknown) {
            let mut join = Join::new(self.tri_removed.len());
            for list in self.corner_hash.lists() {
                for pair in list.windows(2) {
                    join.unite(pair[0] / 3, pair[1] / 3);
                }
            }
            let mut live =
                (0..self.tri_removed.len() as u32).filter(|&t| !self.tri_removed[t as usize]);
            let first = live.next().map(|t| join.root(t));
            let many = live.any(|t| Some(join.root(t)) != first);
            self.ghosts.pieces = if many {
                Pieces::Many(join)
            } else {
                Pieces::One
            };
        }
        matches!(self.ghosts.pieces, Pieces::Many(_))
    }

    /// The squared hole a collapse of the gathered triangles `tris`, moving `ends` to `to`, opens:
    /// `floor`, the cost it has without it, unless larger; `made` when the collapse is.
    pub(in super::super) fn hole_opened(
        &mut self,
        tris: &[usize],
        ends: [P; 2],
        to: P,
        floor: f32,
        made: bool,
    ) -> f32 {
        let (ghosts, live) = self.ghosts_and_surface();
        ghosts.hole(&live, tris, ends, to, floor, made)
    }

    /// Leaves the ghosts of the triangles `tris` a collapse costing `cost` gathers, in a region of
    /// more than one piece.
    pub(in super::super) fn leave_ghosts(&mut self, tris: &[usize], cost: f32) {
        if self.many_pieces() {
            let (ghosts, live) = self.ghosts_and_surface();
            ghosts.leave(&live, tris, cost);
        }
    }

    /// Starts from the ghosts `carried`, in object space, the frame `scale` times it.
    pub(in super::super) fn seed_ghosts(&mut self, carried: &[CarriedGhost], scale: f32) {
        if carried.is_empty() || !self.many_pieces() {
            return;
        }
        let corner_hash = std::mem::take(&mut self.corner_hash);
        let at = |p: P| corner_hash.at(p).last().map(|&corner| corner / 3);
        let (ghosts, live) = self.ghosts_and_surface();
        ghosts.seed(&live, carried, scale, at);
        self.corner_hash = corner_hash;
    }

    /// The ghosts to hand on once the simplification has ended, in object space by `inverse`,
    /// those whose size, twice over, is above `least`, in the frame.
    pub(in crate::qem::solve) fn carried(&mut self, least: f32, inverse: f32) -> Vec<CarriedGhost> {
        let (ghosts, live) = self.ghosts_and_surface();
        ghosts.carried(&live, least, inverse)
    }
}
