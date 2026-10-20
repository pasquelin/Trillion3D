//! The polygons around the crossed edges.
use super::super::grid::{add, leaf_offset, leaf_origin, local_coord, Coord, SIZE};
use super::super::tables::EDGE_GROUP;
use super::regions::{add_prim, Aux};
use super::{INSIDE, INVALID_POINT, SIGNS, XEDGE, YEDGE, ZEDGE};
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordMap;

/// The polygons around the crossed edges of `aux`, a quad collapsed to a triangle where two
/// corners share a region, per leaf.
pub(super) fn polygons(
    aux: &[Aux],
    find: &WordMap<Coord, usize>,
    point_index: &[Box<[u32; SIZE]>],
) -> Vec<(Vec<[u32; 4]>, Vec<[u32; 3]>)> {
    let probe = |c: Coord| match find.get(&leaf_origin(c)) {
        Some(&i) => (
            point_index[i][leaf_offset(c)],
            aux[i].on.is_on(leaf_offset(c)),
        ),
        None => (INVALID_POINT, false),
    };
    let sign_at = |c: Coord| match find.get(&leaf_origin(c)) {
        Some(&i) => (SIGNS & aux[i].flags[leaf_offset(c)]) as usize,
        None => 0,
    };
    aux.par_iter()
        .map(|a| {
            let (mut quads, mut triangles) = (Vec::new(), Vec::new());
            for pos in a.on.ons() {
                let flags = a.flags[pos];
                if flags & 0xE00 == 0 {
                    continue;
                }
                let cell = (SIGNS & flags) as usize;
                let table = &EDGE_GROUP[cell];
                let offsets: [u32; 3] = if table[0] > 1 {
                    [table[1], table[9], table[4]].map(|g| u32::from(g).wrapping_sub(1))
                } else {
                    [0; 3]
                };
                let ijk = add(a.origin, local_coord(pos));
                // The polygon around this crossed edge.
                let (v0, on) = probe(ijk);
                if !on || v0 == INVALID_POINT {
                    continue;
                }
                let is_inside = flags & INSIDE != 0;
                // (edge flag, offset slot, the three neighbours and their edge group columns, reversed).
                let edges: [(i16, usize, [(Coord, usize); 3], bool); 3] = [
                    (
                        XEDGE,
                        0,
                        [([0, -1, 0], 5), ([0, -1, -1], 7), ([0, 0, -1], 3)],
                        is_inside,
                    ),
                    (
                        YEDGE,
                        1,
                        [([0, 0, -1], 12), ([-1, 0, -1], 11), ([-1, 0, 0], 10)],
                        is_inside,
                    ),
                    (
                        ZEDGE,
                        2,
                        [([0, -1, 0], 8), ([-1, -1, 0], 6), ([-1, 0, 0], 2)],
                        !is_inside,
                    ),
                ];
                for (edge, slot, around, reverse) in edges {
                    if flags & edge == 0 {
                        continue;
                    }
                    let mut quad = [v0.wrapping_add(offsets[slot]), 0, 0, 0];
                    let mut all = true;
                    for (n, (o, column)) in around.into_iter().enumerate() {
                        let c = add(ijk, o);
                        let (v, active_value) = probe(c);
                        all = all && active_value;
                        if !all {
                            break;
                        }
                        let cell = sign_at(c);
                        let extra = if EDGE_GROUP[cell][0] > 1 {
                            u32::from(EDGE_GROUP[cell][column]).wrapping_sub(1)
                        } else {
                            0
                        };
                        quad[n + 1] = v.wrapping_add(extra);
                    }
                    if all {
                        add_prim(&mut quads, &mut triangles, quad, reverse);
                    }
                }
            }
            (quads, triangles)
        })
        .collect()
}
