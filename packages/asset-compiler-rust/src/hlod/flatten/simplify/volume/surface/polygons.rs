//! The polygons, leaf by leaf in the tree's order: per crossed cell by rank, and per edge from
//! its voxel towards `+x`, `+y`, `+z` the surface crosses, the quad over the points that sheet
//! gives the four cells around the edge — the cell itself, then the three others in `AROUND`
//! order —, kept when all four cells are crossed. Its order is reversed along `x` and `y` when the
//! voxel lies inside, along `z` when it lies outside, so that every quad faces the same side.
//!
//! Where merged cells share a point a quad loses corners: it stays a quad when its four points
//! differ, becomes a triangle when exactly two consecutive corners coincide, and is dropped
//! otherwise. Without any merge every quad keeps four points, and the mesh is the plain quad mesh.
//!
//! Each leaf reads the trees only, so the leaves run in parallel, each filling its own lists.
use super::super::tree::{offset, shift, Coord, Leaf, Tree};
use super::cell::AROUND;
use super::flags::{ANY_CROSSING, CROSSES, FIRST_INSIDE, SIGN_MASK};
use super::sheets::SHEETS;
use rayon::prelude::*;

/// A leaf's polygons over the shared points, in the order they are made.
pub(super) struct LeafPolygons {
    /// The quads, four points each in turn around them.
    pub(super) quads: Vec<[u32; 4]>,
    /// The triangles left by quads that lost a corner.
    pub(super) triangles: Vec<[u32; 3]>,
}

/// Per axis, the column of `SHEETS` naming the sheet that crosses the edge from a cell's voxel
/// towards `+` along it, in the cell's own row.
const OWN_EDGE: [usize; 3] = [1, 9, 4];

/// Per axis, the column naming the sheet across the same edge in the rows of the three cells
/// around it, in `AROUND` order.
const THEIR_EDGE: [[usize; 3]; 3] = [[5, 7, 3], [12, 11, 10], [8, 6, 2]];

/// The polygons of each leaf of `flags`, over the first points `slots` holds.
pub(super) fn polygons(flags: &Tree<u16>, slots: &Tree<u32>) -> Vec<LeafPolygons> {
    let leaves: Vec<&Leaf<u16>> = flags.leaves().collect();
    let slot_leaves: Vec<&Leaf<u32>> = slots.leaves().collect();
    leaves
        .par_iter()
        .zip(slot_leaves.par_iter())
        .map(|(leaf, leaf_slots)| leaf_polygons(flags, slots, leaf, leaf_slots))
        .collect()
}

/// The step from a cell's first point to the point of the sheet that crosses the edge of column
/// `column` in a cell of flags `flag`: none unless several sheets cross the cell. The sum wraps as
/// the unsigned point numbers do.
fn sheet_step(flag: u16, column: usize) -> u32 {
    let row = &SHEETS[usize::from(flag & SIGN_MASK)];
    match row[0] > 1 {
        true => u32::from(row[column]).wrapping_sub(1),
        false => 0,
    }
}

/// The polygons of one leaf. A neighbour's flags, slot and activity are read from the leaf when
/// it lies in it, else through the trees: the same values.
fn leaf_polygons(
    flags: &Tree<u16>,
    slots: &Tree<u32>,
    leaf: &Leaf<u16>,
    leaf_slots: &Leaf<u32>,
) -> LeafPolygons {
    let origin = leaf.origin;
    let at = |c: Coord| match (0..3).all(|k| c[k] >= origin[k]) {
        true => {
            let pos = offset(c);
            (
                leaf.values[pos],
                leaf_slots.values[pos],
                leaf_slots.is_on(pos),
            )
        }
        false => {
            let (slot, on) = slots.probe(c);
            (flags.get(c), slot, on)
        }
    };
    let mut out = LeafPolygons {
        quads: Vec::new(),
        triangles: Vec::new(),
    };
    for pos in leaf.active() {
        let flag = leaf.values[pos];
        if flag & ANY_CROSSING == 0 {
            continue;
        }
        let c = leaf.coord(pos);
        let first = leaf_slots.values[pos];
        let inside = flag & FIRST_INSIDE != 0;
        for axis in 0..3 {
            if flag & CROSSES[axis] == 0 {
                continue;
            }
            let mut quad = [
                first.wrapping_add(sheet_step(flag, OWN_EDGE[axis])),
                0,
                0,
                0,
            ];
            let mut whole = true;
            let around = AROUND[axis].iter().zip(&THEIR_EDGE[axis]);
            for (corner, (&d, &column)) in quad[1..].iter_mut().zip(around) {
                let (their_flag, slot, on) = at(shift(c, d));
                *corner = slot.wrapping_add(sheet_step(their_flag, column));
                whole &= on;
            }
            if whole {
                out.add(quad, inside != (axis == 2));
            }
        }
    }
    out
}

impl LeafPolygons {
    /// The quad `[a, b, c, d]`, its order reversed when `reverse`: a quad when its four points
    /// differ; a triangle when exactly one pair of consecutive corners — `d a`, `b c`, `a b`, then
    /// `c d`, the first that matches — coincides, the triangle's other corners all differing; else
    /// nothing.
    fn add(&mut self, [a, b, c, d]: [u32; 4], reverse: bool) {
        if a != b && a != c && a != d && b != c && b != d && c != d {
            self.quads
                .push(if reverse { [d, c, b, a] } else { [a, b, c, d] });
        } else if a == d && b != c && b != a && c != a {
            self.triangle([a, b, c], reverse);
        } else if b == c && a != d && a != b && d != b {
            self.triangle([a, b, d], reverse);
        } else if a == b && c != d && c != a && d != a {
            self.triangle([a, c, d], reverse);
        } else if c == d && a != b && a != c && b != c {
            self.triangle([a, b, c], reverse);
        }
    }

    /// The triangle `[a, b, c]`, its order reversed when `reverse`.
    fn triangle(&mut self, [a, b, c]: [u32; 3], reverse: bool) {
        self.triangles
            .push(if reverse { [c, b, a] } else { [a, b, c] });
    }
}
