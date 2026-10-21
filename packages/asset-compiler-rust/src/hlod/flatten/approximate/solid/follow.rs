//! The march by continuation: front after front of cells, each front's new corners read in one
//! list — one trip to the GPU a front — (`follow`), then the crossed cells meshed (`mesh`).
use super::super::grid_key::{self, edge_ends, key, unkey, Leaves};
use super::super::marching::{triangles, EDGES};
use super::crossing::crossings;
use super::{Grid, Implicit};
use crate::hlod::flatten::first_seen::first_seen;
use rayon::prelude::*;

/// The cells of a front read at once: a wide front's corner lists (some 100 bytes a cell) stay
/// within some 100 MB.
const SLICE: usize = 1 << 20;

/// What `follow` found: the corners' values, on the grid's own leaves, read by their coordinates
/// (`grid_key::Leaves`), and each crossed cell by its key and its corners' mask.
pub(super) type Followed = (Leaves<f32>, Vec<(u64, u8)>);

/// The value read at corner `c`.
fn value(values: &Leaves<f32>, c: [i64; 3]) -> f32 {
    values.get(c).expect("a corner read")
}

/// The surface `implicit` crosses `threshold` on, followed from the cells holding `seeds`
/// (marching cubes by continuation): a seed's cell is read whether the surface crosses it or not,
/// and only a crossed cell's neighbours across its faces join the next front, so the cells reached
/// are those of the surface connected to a seed's crossed cell. Front after front, each front's
/// corners not met before read in one list. Each step runs side by side and keeps the order one
/// pass over the cells would give (`first_seen`): the cells come out the same whatever the
/// threads, and the same cells as one seed after the other, each followed to its end.
pub(super) fn follow(
    grid: &Grid,
    (seeds, threshold): (&[[f64; 3]], f64),
    implicit: &mut Implicit,
) -> crate::Result<Followed> {
    // The corners' values and the cells met, on the grid's own leaves (`Followed`).
    let mut values: Leaves<f32> = Leaves::new(grid.cells.map(|n| n + 1));
    let mut done: Leaves<()> = Leaves::new(grid.cells);
    // The seeds' cells, each at its first naming, met as it joins the front: a seed's cell its
    // offset from the origin in cells, truncated toward zero, so a seed within a cell below the
    // origin lands in the first cell.
    let mut front: Vec<[i64; 3]> = Vec::new();
    for seed in seeds {
        let cell: [i64; 3] =
            std::array::from_fn(|k| ((seed[k] - grid.origin[k]) / grid.cell).trunc() as i64);
        if grid.holds(cell) && done.insert(cell, ()) {
            front.push(cell);
        }
    }
    let inside = |v: f32| f64::from(v) >= threshold;
    // Each crossed cell by its key and its corners' mask.
    let mut crossed: Vec<(u64, u8)> = Vec::new();
    while !front.is_empty() {
        // The front a slice at a time, so its corner lists stay bounded however wide it is; the
        // slices' new neighbours, each slice's in first-naming order, in slice order.
        let mut named: Vec<u64> = Vec::new();
        for slice in front.chunks(SLICE) {
            let mut needed: Vec<u64> = (slice.par_iter())
                .flat_map_iter(|&c| (0..8).map(move |k| Grid::corner_at(c, k)))
                .filter(|&c| !values.contains(c))
                .map(key)
                .collect();
            needed.par_sort_unstable();
            needed.dedup();
            let points: Vec<[f64; 3]> = needed.par_iter().map(|&c| grid.corner(unkey(c))).collect();
            let computed = implicit(&points)?;
            drop(points);
            for (&c, v) in needed.iter().zip(computed) {
                values.insert(unkey(c), v);
            }
            drop(needed);
            let masks: Vec<u8> = (slice.par_iter())
                .map(|&cell| {
                    (0..8).fold(0u8, |mask, k| {
                        let v = value(&values, Grid::corner_at(cell, k));
                        mask | u8::from(inside(v)) << k
                    })
                })
                .collect();
            let crossing = |mask: u8| mask != 0 && mask != 255;
            // The crossed cells' neighbours not met before, in the order the cells and their
            // faces name them.
            let met = &done;
            let around: Vec<u64> = (slice.par_iter().zip(masks.par_iter()))
                .filter(|&(_, &mask)| crossing(mask))
                .flat_map_iter(move |(&cell, _)| {
                    (0..3)
                        .flat_map(move |axis| {
                            [-1i64, 1].map(move |step| {
                                let mut n = cell;
                                n[axis] += step;
                                n
                            })
                        })
                        .filter(move |&n| grid.holds(n) && !met.contains(n))
                        .map(key)
                })
                .collect();
            // A key first named in a slice comes before those first named in the next: each
            // slice's distinct keys, concatenated, keep the front's first-naming order.
            named.par_extend(first_seen(around).0);
            crossed.par_extend(
                (slice.par_iter().zip(masks.par_iter()))
                    .filter(|&(_, &mask)| crossing(mask))
                    .map(|(&cell, &mask)| (key(cell), mask)),
            );
        }
        let (next, _) = first_seen(named);
        front = next.into_par_iter().map(|cell| unkey(cell)).collect();
        for &cell in &front {
            done.insert(cell, ());
        }
    }
    Ok((values, crossed))
}

/// The surface `follow` found on `grid` meshed: each crossed edge's crossing of `threshold` on
/// `implicit` (`crossings`), the vertices and the triangles in the order of the crossed cells, the
/// same whatever the threads.
pub(super) fn mesh(
    grid: &Grid,
    threshold: f64,
    (values, crossed): Followed,
    implicit: &mut Implicit,
) -> crate::Result<(Vec<f32>, Vec<u32>)> {
    // One vertex per crossed grid edge, shared by the cells around it: an edge keyed by its lower
    // corner and its axis, numbered in the order the crossed cells' triangles first name it.
    let named: Vec<u64> = (crossed.par_iter())
        .flat_map_iter(|&(cell, mask)| {
            let cell: [i64; 3] = unkey(cell);
            triangles(usize::from(mask))
                .iter()
                .flatten()
                .map(move |&e| {
                    let (a, b) = EDGES[e as usize];
                    grid_key::edge_key(Grid::corner_at(cell, a), Grid::corner_at(cell, b))
                })
        })
        .collect();
    drop(crossed);
    let (edges, indices) = first_seen(named);
    // Each edge's ends and their values, kept so the corners' values go before the crossings are
    // found.
    let ends: Vec<([f64; 3], f64, [f64; 3], f64)> = (edges.par_iter())
        .map(|&edge| {
            let (low, high) = edge_ends(edge);
            let read = |c: [i64; 3]| f64::from(value(&values, c));
            (grid.corner(low), read(low), grid.corner(high), read(high))
        })
        .collect();
    drop((values, edges));
    let positions = crossings(ends, threshold, implicit)?;
    Ok((positions, indices))
}
