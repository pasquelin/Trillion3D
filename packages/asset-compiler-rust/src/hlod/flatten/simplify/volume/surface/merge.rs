//! Under an adaptivity past `10⁻⁷`, each leaf's crossed cells merged into regions of one point:
//! the blocks of 2³ cells, then of 4³, then the whole leaf, each merged unless it is held apart,
//! tangled (`manifold::tangled`), or the field's directions over its cells differ by more than the
//! adaptivity. A block that does not merge holds apart the block of twice its span around it.
//!
//! Each leaf is merged from the field and the flags alone, writing only its own slots, so the
//! leaves run in parallel. The regions are numbered from `1` in each leaf in the order the blocks
//! are tried — span by span, then `x`, `y`, `z` —, a larger block's number overwriting its cells'.
use super::super::tree::{offset, shift, Coord, Leaf, Tree, LEAF_SIDE};
use super::cases::COLLAPSIBLE;
use super::cell::{direction, gradient, AROUND};
use super::flags::{ANY_CROSSING, CROSSES, SIGN_MASK};
use super::manifold::tangled;
use super::sheets::SHEETS;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::dot;

/// The cells of `flags` merged under `adaptivity` (single precision, as the merge reads it), each
/// merged block's number written in the slots of all its voxels, crossed or not.
pub(super) fn merge(
    field: &Tree<f32>,
    flags: &Tree<u16>,
    slots: &mut Tree<u32>,
    level: f32,
    adaptivity: f32,
) {
    let leaves: Vec<&Leaf<u16>> = flags.leaves().collect();
    slots
        .leaves_mut()
        .into_par_iter()
        .zip(leaves.par_iter())
        .for_each(|(slots, leaf)| merge_leaf(field, flags, leaf, slots, level, adaptivity));
}

/// One leaf merged. Held apart first: the pair of every cell whose configuration a merged block
/// may not show or that several sheets cross, and of every crossed cell missing a neighbour around
/// one of its crossed edges; then every tangled pair. The directions are read at the cells of the
/// pairs not held, and compared when the adaptivity stays under `1`.
fn merge_leaf(
    field: &Tree<f32>,
    flags: &Tree<u16>,
    leaf: &Leaf<u16>,
    slots: &mut Leaf<u32>,
    level: f32,
    adaptivity: f32,
) {
    let mut held = Leaf::filled(leaf.origin, ());
    for pos in leaf.active() {
        let flag = leaf.values[pos];
        let signs = usize::from(flag & SIGN_MASK);
        let c = leaf.coord(pos);
        if COLLAPSIBLE[signs] == 0
            || SHEETS[signs][0] > 1
            || (flag & ANY_CROSSING != 0 && lacks_neighbour(flags, c, flag))
        {
            held.set_on(lowest(c, 2), true);
        }
    }
    for b in corners(leaf.origin, 2) {
        if !held.is_on(offset(b)) && tangled(field, b, level, 2) {
            held.set_on(offset(b), true);
        }
    }
    let compare = adaptivity < 1.0;
    let mut directions = Leaf::filled(leaf.origin, [0.0; 3]);
    if compare {
        for pos in leaf.active() {
            let c = leaf.coord(pos);
            if !held.is_on(lowest(c, 2)) {
                directions.set(pos, direction(gradient(field, c)));
            }
        }
    }
    let mut region = 1;
    for span in [2, 4, LEAF_SIDE] {
        for b in corners(leaf.origin, span) {
            if held.is_on(offset(b))
                || tangled(field, b, level, span)
                || (compare && !aligned(&directions, b, span, adaptivity))
            {
                held.set_on(lowest(b, 2 * span), true);
            } else {
                for pos in block(b, span) {
                    slots.values[pos] = region;
                }
                region += 1;
            }
        }
    }
}

/// Whether one of the three cells around a crossed edge of the cell `c` of flags `flag` is not a
/// crossed cell — the slot tree's active voxels being the flags tree's.
fn lacks_neighbour(flags: &Tree<u16>, c: Coord, flag: u16) -> bool {
    CROSSES.iter().zip(&AROUND).any(|(&crosses, around)| {
        flag & crosses != 0 && around.iter().any(|&d| !flags.probe(shift(c, d)).1)
    })
}

/// Whether the directions set in the block of `span` cells a side at `b` agree within
/// `adaptivity`: no pair, each against each and itself, whose dot product falls more than the
/// adaptivity short of `1`. An adaptivity under `10⁻⁶` merges nothing.
fn aligned(directions: &Leaf<[f32; 3]>, b: Coord, span: i32, adaptivity: f32) -> bool {
    let limit = f64::from(adaptivity);
    if limit < 1e-6 {
        return false;
    }
    let set = || {
        block(b, span)
            .filter(|&pos| directions.is_on(pos))
            .map(|pos| directions.values[pos])
    };
    !set().any(|n| set().any(|m| 1.0 - f64::from(dot(n, m)) > limit))
}

/// The rank in its leaf of the lowest corner of the block of `span` cells a side holding `c`.
fn lowest(c: Coord, span: i32) -> usize {
    offset(c.map(|x| x & !(span - 1)))
}

/// The lowest corners of a leaf's blocks of `span` cells a side, `x` slowest, `z` fastest.
fn corners(origin: Coord, span: i32) -> Vec<Coord> {
    let steps = (0..LEAF_SIDE).step_by(span as usize);
    let mut out = Vec::new();
    for x in steps.clone() {
        for y in steps.clone() {
            for z in steps.clone() {
                out.push(shift(origin, [x, y, z]));
            }
        }
    }
    out
}

/// The ranks of the cells of the block of `span` cells a side at `b`.
fn block(b: Coord, span: i32) -> impl Iterator<Item = usize> {
    (0..span).flat_map(move |x| {
        (0..span).flat_map(move |y| (0..span).map(move |z| offset(shift(b, [x, y, z]))))
    })
}
