//! Every polygon's voxels (step 1 of `field`): each triangle floods the voxels about it and
//! writes in each its squared distance to the triangle, in voxels², where it is less than what
//! the voxel holds; at an equal distance the voxel keeps the least polygon. A quad is its triangles
//! `(a, b, c)` and `(a, d, c)`. While the polygons are fewer than a thousand, a triangle whose box
//! is two leaves wide or more is split at its edges' middles into four, recursively, the count
//! taken four times larger at each split, until the splits run out or the count reaches a
//! thousand.
//!
//! A flood starts at the voxel holding the triangle's first corner, and goes from it, then from
//! each voxel it writes within `BOUNDARY`, on to the neighbours it has not reached yet; a NaN
//! distance writes nothing and goes no further. Which voxels a triangle reaches does
//! not depend on the order it visits them, nor on the other triangles, and the least distance
//! and least polygon do not depend on the order the triangles come in: the polygons are shared
//! among threads, each share kept in its own trees, the shares then merged voxel by voxel.
use super::super::tree::{offset, shift, Coord, Leaf, Tree, LEAF_SIDE, LEAF_SIZE};
use super::closest::on_triangle;
use super::{Polygons, BOUNDARY, NEIGHBOURS, NO_POLYGON};
use crate::hlod::flatten::uv::extremes::{greater, lesser};
use rayon::prelude::*;
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vecn::{add, scale, squared_length, sub};
use trillion3d_page_codec::hash::WordSet;

type V3 = [f64; 3];

/// The polygon count under which a wide triangle splits, and its parts keep splitting.
const SPLIT_UNDER: usize = 1000;

/// The marks a share keeps room for between two triangles: a large triangle's table is given
/// back rather than cleared at every triangle after it.
const MARKS_KEPT: usize = 4096;

/// A triangle of polygon `index`, its corners in index space.
#[derive(Clone, Copy)]
struct Facet {
    a: V3,
    b: V3,
    c: V3,
    index: i32,
}

/// One share of the work: each voxel's least squared distance, in voxels², and the least polygon
/// at it, both active where written (backgrounds `f32::MAX` and `NO_POLYGON`), and the voxels the
/// triangle being flooded has reached.
struct Share {
    distance: Tree<f32>,
    closest: Tree<i32>,
    reached: WordSet<Coord>,
}

/// The squared distances, in voxels², and the closest polygons of every polygon's voxels.
pub(super) fn voxelize(polygons: &impl Polygons) -> (Tree<f32>, Tree<i32>) {
    let count = polygons.count();
    let all = (0..count)
        .into_par_iter()
        .fold(Share::new, |mut share, polygon| {
            share.polygon(polygons, polygon, count);
            share
        })
        .reduce(Share::new, Share::absorb);
    (all.distance, all.closest)
}

impl Share {
    /// A share with nothing written yet.
    fn new() -> Self {
        Self {
            distance: Tree::new(f32::MAX),
            closest: Tree::new(NO_POLYGON),
            reached: WordSet::default(),
        }
    }

    /// Polygon `polygon` of the `count`: its first triangle, and for a quad its second.
    fn polygon(&mut self, polygons: &impl Polygons, polygon: usize, count: usize) {
        let corner = |k| polygons.point(polygon, k);
        let mut facet = Facet {
            a: corner(0),
            b: corner(1),
            c: corner(2),
            index: polygon as i32,
        };
        self.facet(facet, count);
        if polygons.corners(polygon) == 4 {
            facet.b = corner(3);
            self.facet(facet, count);
        }
    }

    /// A triangle flooded whole, or split when the polygons are few and it is wide.
    fn facet(&mut self, facet: Facet, count: usize) {
        let splits = if count < SPLIT_UNDER {
            splits(&facet)
        } else {
            0
        };
        if splits <= 0 {
            self.flood(&facet);
        } else {
            self.split(&facet, splits, count);
        }
    }

    /// `facet`'s four parts, each flooded once the splits run out or the count, four times
    /// larger, reaches `SPLIT_UNDER`, else split again.
    fn split(&mut self, facet: &Facet, splits: i32, count: usize) {
        let (splits, count) = (splits - 1, count * 4);
        let Facet { a, b, c, index } = *facet;
        let (ac, bc, ab) = (middle(a, c), middle(b, c), middle(a, b));
        for [a, b, c] in [[a, ab, ac], [ab, bc, ac], [ab, b, bc], [ac, bc, c]] {
            let part = Facet { a, b, c, index };
            if splits <= 0 || count >= SPLIT_UNDER {
                self.flood(&part);
            } else {
                self.split(&part, splits, count);
            }
        }
    }

    /// The voxels about `facet` reached and written, from the one holding its first corner.
    fn flood(&mut self, facet: &Facet) {
        self.reached.clear();
        self.reached.shrink_to(MARKS_KEPT);
        let start = facet.a.map(|x| x.floor() as i32);
        self.write(start, facet);
        self.reached.insert(start);
        let mut pending = vec![start];
        while let Some(voxel) = pending.pop() {
            for step in NEIGHBOURS {
                let next = shift(voxel, step);
                if self.reached.insert(next) && self.write(next, facet) {
                    pending.push(next);
                }
            }
        }
    }

    /// `voxel`'s squared distance to `facet`, written where less than its own, its polygon
    /// lowered to `facet`'s where equal; whether the flood goes on from it — not for NaN.
    fn write(&mut self, voxel: Coord, facet: &Facet) -> bool {
        let centre = voxel.map(f64::from);
        let point = on_triangle(facet.a, facet.c, facet.b, centre);
        let distance = squared_length(sub(centre, point)) as f32;
        if distance.is_nan() {
            return false;
        }
        // The voxel's leaf read and, where `distance` is less, written in one descent; a voxel no
        // leaf holds reads the background, `f32::MAX`.
        let pos = offset(voxel);
        let least = match self.distance.leaf_mut(voxel) {
            Some(leaf) => {
                let least = leaf.values[pos];
                if distance < least {
                    leaf.set(pos, distance);
                }
                least
            }
            None => {
                if distance < f32::MAX {
                    self.distance.touch(voxel).set(pos, distance);
                }
                f32::MAX
            }
        };
        if distance < least {
            self.closest.touch(voxel).set(pos, facet.index);
        } else if distance == least {
            let leaf = self.closest.touch(voxel);
            leaf.values[pos] = facet.index.min(leaf.values[pos]);
        }
        not_above(distance, BOUNDARY)
    }

    /// `other` merged in: its leaves where this share has none, else voxel by voxel
    /// (`take_lesser`).
    fn absorb(mut self, mut other: Share) -> Share {
        for theirs in other.distance.take_leaves() {
            let origin = theirs.origin;
            match self.distance.leaf_mut(origin) {
                None => self.distance.add(theirs),
                Some(mine) => {
                    // A distance leaf always has its polygon leaf: `write` makes both.
                    let closest = (self.closest.leaf_mut(origin), other.closest.leaf(origin));
                    if let (Some(my_closest), Some(their_closest)) = closest {
                        take_lesser(mine, my_closest, &theirs, their_closest);
                    }
                }
            }
        }
        for theirs in other.closest.take_leaves() {
            if self.closest.leaf(theirs.origin).is_none() {
                self.closest.add(theirs);
            }
        }
        self
    }
}

/// Each voxel another share wrote taken where its distance is less, its polygon lowered to the
/// other's where the distances are equal (and made active).
fn take_lesser(
    mine: &mut Leaf<f32>,
    my_closest: &mut Leaf<i32>,
    theirs: &Leaf<f32>,
    their_closest: &Leaf<i32>,
) {
    for pos in 0..LEAF_SIZE {
        let index = their_closest.values[pos];
        if index == NO_POLYGON {
            continue;
        }
        let (least, distance) = (mine.values[pos], theirs.values[pos]);
        if distance < least {
            mine.set(pos, distance);
            my_closest.set(pos, index);
        } else if distance == least {
            my_closest.set(pos, my_closest.values[pos].min(index));
        }
    }
}

/// How many times `facet` splits: its box's widest side over two leaves, truncated.
fn splits(facet: &Facet) -> i32 {
    let Facet { a, b, c, .. } = *facet;
    let extent = |k: usize| greater(a[k], greater(b[k], c[k])) - lesser(a[k], lesser(b[k], c[k]));
    let widest = greater(extent(0), greater(extent(1), extent(2)));
    (widest / f64::from(2 * LEAF_SIDE)) as i32
}

/// The middle of `p` and `q`: their sum halved.
fn middle(p: V3, q: V3) -> V3 {
    scale(add(p, q), 0.5)
}
