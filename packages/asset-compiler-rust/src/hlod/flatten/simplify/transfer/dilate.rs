//! The grid's values grown outward one ring at a time from its valid texels, as the method dilates
//! them: a ring is every texel not yet valid with a valid texel among its four neighbours — left,
//! right, above, below — (`ring`), each then the mean of those neighbours: each neighbour's value
//! times one where it is valid and zero where it is not — a neighbour past the grid's edge zero —,
//! summed in that order, times the inverse of the valid count (`fill`), and valid from the next
//! ring on. Every ring reads the values the ring before left, so the order its texels are filled in
//! changes nothing.
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{add, scale};

/// A texel of a ring: its rank, and which of its four neighbours are valid.
pub(super) type Rim = (usize, [bool; 4]);

/// The ranks of the four neighbours of the texel at `(x, y)` on a grid `side` texels square, each
/// where the grid holds it: left, right, above, below.
fn neighbours(x: usize, y: usize, side: usize) -> [Option<usize>; 4] {
    let at = y * side + x;
    [
        (x > 0).then(|| at - 1),
        (x + 1 < side).then(|| at + 1),
        (y > 0).then(|| at - side),
        (y + 1 < side).then(|| at + side),
    ]
}

/// The next ring of a grid `side` texels square whose valid texels `valid` marks (module doc).
pub(super) fn ring(valid: &[bool], side: usize) -> Vec<Rim> {
    (0..side * side)
        .into_par_iter()
        .filter(|&at| !valid[at])
        .filter_map(|at| {
            let near = neighbours(at % side, at / side, side);
            let around = near.map(|n| n.is_some_and(|n| valid[n]));
            around.contains(&true).then_some((at, around))
        })
        .collect()
}

/// The ring after `ring`, whose texels `valid` already marks: every texel not yet valid with a
/// valid neighbour is a neighbour of a texel of `ring`, as one beside an older valid texel would
/// have been in `ring` or before it, so the neighbours of `ring` are all that need be read. In
/// order of rank, as `ring` lists them.
pub(super) fn next_ring(valid: &[bool], side: usize, ring: &[Rim]) -> Vec<Rim> {
    let mut found: Vec<usize> = ring
        .iter()
        .flat_map(|&(at, _)| neighbours(at % side, at / side, side))
        .flatten()
        .filter(|&n| !valid[n])
        .collect();
    found.par_sort_unstable();
    found.dedup();
    found
        .into_par_iter()
        .filter_map(|at| {
            let near = neighbours(at % side, at / side, side);
            let around = near.map(|n| n.is_some_and(|n| valid[n]));
            around.contains(&true).then_some((at, around))
        })
        .collect()
}

/// `grid`'s texels of `ring` each the mean of its valid neighbours (module doc), the grid `side`
/// texels square.
pub(super) fn fill<const N: usize>(grid: &mut [[f32; N]], side: usize, ring: &[Rim]) {
    let values: Vec<[f32; N]> = ring
        .par_iter()
        .map(|&(at, around)| {
            let near = neighbours(at % side, at / side, side);
            let term = |k: usize| {
                let value = near[k].map_or([0.0; N], |n| grid[n]);
                scale(value, f32::from(u8::from(around[k])))
            };
            let sum = add(add(add(term(0), term(1)), term(2)), term(3));
            let count = around.iter().filter(|&&v| v).count();
            scale(sum, 1.0 / count as f32)
        })
        .collect();
    for (&(at, _), value) in ring.iter().zip(values) {
        grid[at] = value;
    }
}
