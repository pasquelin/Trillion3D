//! The atlas's empty texels filled: eight neighbours, hole infill, the texels left empty.
use super::{EMPTY, HOLE, SAMPLED};
use rayon::prelude::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// The eight neighbours of texel `at` of a `size` square, row by row from the top left: a fixed
/// order, so the infill's averages are the same on every run.
fn neighbours8(size: usize, at: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((at % size) as i64, (at / size) as i64);
    const OFFSETS: [(i64, i64); 8] = [
        (-1, -1),
        (0, -1),
        (1, -1),
        (-1, 0),
        (1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
    ];
    OFFSETS.into_iter().filter_map(move |(dx, dy)| {
        let (nx, ny) = (x + dx, y + dy);
        let inside = nx >= 0 && ny >= 0 && nx < size as i64 && ny < size as i64;
        inside.then(|| ny as usize * size + nx as usize)
    })
}

/// The marching infill over the holes of `occupancy`, a `size` square: `fill(hole, neighbours)`
/// for each hole in the order it is filled — fewest missing neighbours first —, with the
/// neighbours it averages. The valid neighbours are
/// the texels whose sample found something and the holes already filled; every other texel —
/// empty, gutter — holds the missing value and never feeds a hole. A hole
/// with no valid neighbour when its turn comes is left as it is. Per hole it holds its texel, its
/// priority, its state and at most nine entries of the queue (`INFILL_HOLE_BYTES`).
pub(crate) fn infill(size: usize, occupancy: &[u32], mut fill: impl FnMut(usize, &[usize])) {
    let holes: Vec<u32> = (0..occupancy.len() as u32)
        .filter(|&at| occupancy[at as usize] == HOLE)
        .collect();
    // Per texel, its rank among the holes; `NONE` for any other texel.
    const NONE: u32 = u32::MAX;
    let mut index = vec![NONE; occupancy.len()];
    for (k, &at) in holes.iter().enumerate() {
        index[at as usize] = k as u32;
    }
    let hole = |n: usize| (index[n] != NONE).then(|| index[n] as usize);
    // Per hole: filled, or its turn passed with nothing to fill it from.
    let (mut filled, mut done) = (vec![false; holes.len()], vec![false; holes.len()]);
    let valid =
        |filled: &[bool], n: usize| occupancy[n] == SAMPLED || hole(n).is_some_and(|k| filled[k]);
    let mut priority: Vec<u32> = (holes.iter())
        .map(|&at| {
            8 - neighbours8(size, at as usize)
                .filter(|&n| valid(&filled, n))
                .count() as u32
        })
        .collect();
    let mut queue: BinaryHeap<Reverse<(u32, u32)>> = (priority.iter().enumerate())
        .map(|(k, &p)| Reverse((p, k as u32)))
        .collect();
    let mut from: Vec<usize> = Vec::with_capacity(8);
    while let Some(Reverse((p, k))) = queue.pop() {
        let k = k as usize;
        if done[k] || p != priority[k] {
            continue;
        }
        done[k] = true;
        let at = holes[k] as usize;
        from.clear();
        from.extend(neighbours8(size, at).filter(|&n| valid(&filled, n)));
        if from.is_empty() {
            continue;
        }
        fill(at, &from);
        filled[k] = true;
        for n in neighbours8(size, at) {
            if let Some(m) = hole(n).filter(|&m| !filled[m] && !done[m]) {
                priority[m] -= 1;
                queue.push(Reverse((priority[m], m as u32)));
            }
        }
    }
}

/// The most bytes `infill` holds per hole: its texel and priority (8), its two states (2), and
/// nine queue entries of eight bytes (72).
pub(crate) const INFILL_HOLE_BYTES: usize = 82;

/// Every empty texel of `bytes`, a `size` square RGBA image read through `decode` and written by
/// `encode`, given the mean colour of the nearest texels that are not (pull-push): the occupied
/// texels averaged into ever coarser levels, each empty texel of a level then taking its parent's
/// colour, coarse to fine. The mip levels the engine samples from far then average a chart with
/// its own colour, never with the empty atlas's black, which would darken and blur its borders.
/// Holds a third of a level of four floats a texel at half the side: about 5 bytes a texel.
pub(crate) fn fill_empty(
    size: usize,
    occupancy: &[u32],
    bytes: &mut [u8],
    (decode, encode): (&[f32; 256], fn(f32) -> u8),
) {
    // Each level: its side, and per texel its mean linear colour and whether anything fed it.
    let mut levels: Vec<(usize, Vec<[f32; 4]>)> = Vec::new();
    let mut side = size;
    while side > 1 {
        let half = side.div_ceil(2);
        let mut level = vec![[0.0f32; 4]; half * half];
        let below = levels.last();
        level.par_chunks_mut(half).enumerate().for_each(|(y, row)| {
            for (x, texel) in row.iter_mut().enumerate() {
                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    let (cy, cx) = (2 * y + dy, 2 * x + dx);
                    if cy >= side || cx >= side {
                        continue;
                    }
                    let child = match below {
                        Some((_, finer)) => finer[cy * side + cx],
                        None if occupancy[cy * side + cx] == EMPTY => [0.0; 4],
                        None => {
                            let at = (cy * side + cx) * 4;
                            [0, 1, 2, 3].map(|c| {
                                if c < 3 {
                                    decode[bytes[at + c] as usize]
                                } else {
                                    1.0
                                }
                            })
                        }
                    };
                    if child[3] > 0.0 {
                        for c in 0..3 {
                            texel[c] += child[c];
                        }
                        texel[3] += 1.0;
                    }
                }
                if texel[3] > 0.0 {
                    let n = texel[3];
                    *texel = [texel[0] / n, texel[1] / n, texel[2] / n, 1.0];
                }
            }
        });
        levels.push((half, level));
        side = half;
    }
    // Coarse to fine: an empty texel takes its parent's colour.
    for k in (1..levels.len()).rev() {
        let (upper, lower) = levels.split_at_mut(k);
        let (side, finer) = &mut upper[k - 1];
        let (parent_side, coarser) = &lower[0];
        for (at, texel) in finer.iter_mut().enumerate() {
            if texel[3] == 0.0 {
                *texel = coarser[(at / *side / 2) * parent_side + (at % *side) / 2];
            }
        }
    }
    let Some((half, first)) = levels.first() else {
        return;
    };
    bytes
        .par_chunks_mut(size * 4)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..size {
                let parent = first[(y / 2) * half + x / 2];
                if occupancy[y * size + x] == EMPTY && parent[3] > 0.0 {
                    for c in 0..3 {
                        row[x * 4 + c] = encode(parent[c]);
                    }
                }
            }
        });
}
