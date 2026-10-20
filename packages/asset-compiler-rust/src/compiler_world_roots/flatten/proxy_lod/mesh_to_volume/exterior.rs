//! Connectivity, sweeps and the exterior.
use super::super::grid::{local_coord, Leaf, Mask, DIM, SIZE};
use trillion3d_page_codec::hash::WordMap;

/// The six axis neighbours of every leaf: the nearest
/// leaf along the axis in either direction, however far.
struct Connectivity {
    pub(super) next: [Vec<u32>; 3],
    pub(super) prev: [Vec<u32>; 3],
}

const NONE: u32 = u32::MAX;

impl Connectivity {
    pub(super) fn new(leaves: &[Box<Leaf>]) -> Connectivity {
        let n = leaves.len();
        let mut next = [vec![NONE; n], vec![NONE; n], vec![NONE; n]];
        let mut prev = [vec![NONE; n], vec![NONE; n], vec![NONE; n]];
        for axis in 0..3 {
            let (p, q) = ((axis + 1) % 3, (axis + 2) % 3);
            let mut columns: WordMap<(i32, i32), Vec<(i32, u32)>> = WordMap::default();
            for (i, leaf) in leaves.iter().enumerate() {
                columns
                    .entry((leaf.origin[p], leaf.origin[q]))
                    .or_default()
                    .push((leaf.origin[axis], i as u32));
            }
            for column in columns.values_mut() {
                column.sort_unstable();
                for pair in column.windows(2) {
                    next[axis][pair[0].1 as usize] = pair[1].1;
                    prev[axis][pair[1].1 as usize] = pair[0].1;
                }
            }
        }
        Connectivity { next, prev }
    }
}

/// One voxel line swept: voxels before the first crossed one turn
/// outside (negative); true when the line ends outside.
fn trace_line(data: &mut [f32; SIZE], mut pos: i32, step: i32) -> bool {
    let mut outside = true;
    for _ in 0..DIM {
        let dist = &mut data[pos as usize];
        if *dist < 0.0 {
            outside = true;
        } else {
            if !(*dist > 0.75) {
                outside = false;
            }
            if outside {
                *dist = -*dist;
            }
        }
        pos += step;
    }
    outside
}

/// Within a leaf, a voxel that crosses nothing turns outside when a
/// face neighbour is outside, until nothing changes.
fn scan_fill(data: &mut [f32; SIZE]) {
    loop {
        let mut updated = false;
        for pos in 0..SIZE {
            let dist = data[pos];
            if !(dist < 0.0) && dist > 0.75 {
                let [x, y, z] = local_coord(pos);
                let outside = (z != 0 && data[pos - 1] < 0.0)
                    || (z != DIM - 1 && data[pos + 1] < 0.0)
                    || (y != 0 && data[pos - 8] < 0.0)
                    || (y != DIM - 1 && data[pos + 8] < 0.0)
                    || (x != 0 && data[pos - 64] < 0.0)
                    || (x != DIM - 1 && data[pos + 64] < 0.0);
                if outside {
                    updated = true;
                    data[pos] = -dist;
                }
            }
        }
        if !updated {
            return;
        }
    }
}

/// The outside traced: every voxel line of every leaf column swept from both ends, then the
/// outside flooded across the leaves.
pub(super) fn trace_exterior(leaves: &mut [Box<Leaf>]) {
    let links = Connectivity::new(leaves);
    // Z, then Y, then X: (the two in-leaf axes, the voxel step).
    for (axis, step) in [(2usize, 1i32), (1, 8), (0, 64)] {
        for start in 0..leaves.len() {
            if links.prev[axis][start] != NONE {
                continue;
            }
            let mut last = start as u32;
            for a in 0..DIM {
                for b in 0..DIM {
                    let pos = match axis {
                        2 => (a << 6) | (b << 3),
                        1 => (a << 6) | b,
                        _ => (a << 3) | b,
                    };
                    let mut offset = start as u32;
                    while offset != NONE && trace_line(&mut leaves[offset as usize].dist, pos, step)
                    {
                        last = offset;
                        offset = links.next[axis][offset as usize];
                    }
                    offset = last;
                    while offset != NONE {
                        last = offset;
                        offset = links.next[axis][offset as usize];
                    }
                    offset = last;
                    let back = pos + step * (DIM - 1);
                    while offset != NONE
                        && trace_line(&mut leaves[offset as usize].dist, back, -step)
                    {
                        offset = links.prev[axis][offset as usize];
                    }
                }
            }
        }
    }
    // The outside flooded
    // within the leaves that changed, then across their faces into the neighbouring leaves.
    let n = leaves.len();
    let mut changed = vec![true; n];
    let mut absorbing = vec![false; n];
    let mut masks = vec![Mask::default(); n];
    loop {
        for (i, leaf) in leaves.iter_mut().enumerate() {
            if changed[i] {
                scan_fill(&mut leaf.dist);
            }
        }
        absorbing.iter_mut().for_each(|b| *b = false);
        let mut candidates: Vec<usize> = Vec::new();
        for i in 0..n {
            if !changed[i] {
                continue;
            }
            for axis in 0..3 {
                for j in [links.next[axis][i], links.prev[axis][i]] {
                    if j != NONE {
                        candidates.push(j as usize);
                    }
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        for &i in &candidates {
            let mut any = false;
            // (axis, first face): Z, Y, X, each its first then its last face.
            for (axis, face_step) in [(2usize, 1usize), (1, 8), (0, 64)] {
                for first in [true, false] {
                    let j = if first {
                        links.prev[axis][i]
                    } else {
                        links.next[axis][i]
                    };
                    if j == NONE || !changed[j as usize] {
                        continue;
                    }
                    let last = face_step * 7;
                    let (lhs_offset, rhs_offset) = if first { (0, last) } else { (last, 0) };
                    let rhs = &leaves[j as usize].dist;
                    let lhs = &leaves[i].dist;
                    for u in 0..8usize {
                        for v in 0..8usize {
                            let pos = match axis {
                                2 => (u << 6) + (v << 3),
                                1 => (u << 6) + v,
                                _ => (u << 3) + v,
                            };
                            if lhs[pos + lhs_offset] > 0.75 && rhs[pos + rhs_offset] < 0.0 {
                                any = true;
                                masks[i].set_on(pos + lhs_offset);
                            }
                        }
                    }
                }
            }
            absorbing[i] = any;
        }
        std::mem::swap(&mut changed, &mut absorbing);
        if !changed.iter().any(|&c| c) {
            return;
        }
        for (i, leaf) in leaves.iter_mut().enumerate() {
            if changed[i] {
                for pos in masks[i].ons().collect::<Vec<_>>() {
                    leaf.dist[pos] = -leaf.dist[pos];
                }
                masks[i] = Mask::default();
            }
        }
    }
}
