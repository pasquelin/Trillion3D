//! ONE MULTILEVEL BISECTION of a weighted graph into two sides of given weights (`bisect`):
//!
//! 1. **Coarsen** (`coarsen`): match each vertex with the unmatched neighbour it shares the
//!    heaviest link with — the first fitting one while every link weighs the same —, visiting the
//!    vertices by rising degree class in a shuffled order (`visiting_order`), pair up the
//!    vertices left over through what they share (two hops), and contract each pair into one
//!    vertex of the next, smaller graph; again until the graph is small, stops shrinking, or runs
//!    out of links.
//! 2. **Cut the coarsest graph** (`grow`): grow the first side breadth-first from a random vertex
//!    until the second side falls to its weight, balance it, refine it; the best cut of a few
//!    tries.
//! 3. **Refine back up** (`refine`): at each finer graph, every vertex on its coarse vertex's side,
//!    the sides rebalanced (`balance`) and the cut moved by the passes of Fiduccia and Mattheyses
//!    (`passes`), each pass undone back to its best point.
//!
//! Each bisection seeds its own random numbers (`Draws::seeded(SEED)`), and every tie breaks by a
//! fixed rule (`trillion3d_math::heap`, `order.rs`): the same graph cuts the same way wherever and whenever it
//! is cut.
//! Coarsening lives in `coarsen`, the contraction in `contract`, the cut and its growth in `cut`, the
//! bounds, random cut, refinement and balance in `refine`, the passes in `passes`.
use super::order::Draws;
use super::Graph;
use std::borrow::Cow;
use trillion3d_math::heap::{Greatest, IndexedHeap};
mod coarsen;
use coarsen::coarsen;
mod contract;
mod cut;
use cut::grow;
mod refine;
use refine::refine;
mod passes;

const SEED: u32 = 4321;
/// The coarsest graph's size the coarsening aims at.
const COARSEN_TO: usize = 20;
/// A level shrinking the graph less than this stops the coarsening.
const COARSEN_FRACTION: f64 = 0.85;
/// The share of vertices left unmatched that calls for matching over two hops.
const UNMATCHED_FOR_TWO_HOPS: f64 = 0.10;
/// The tries of the coarsest cut: fewer when the coarsening reached its aim.
const TRIES_SMALL: usize = 5;
const TRIES_LARGE: usize = 7;
/// Passes of the refinement at each level, and after each try of a cut of a graph with no link.
const PASSES: usize = 10;
const PASSES_UNLINKED: usize = 4;
const UNMATCHED: u32 = u32::MAX;
/// Below this many links (the two members' degrees summed), a pair's merged row is built in its
/// small form, the link to itself held first (`contract`).
const FEW_LINKS: usize = 2047;
const NOT_ON_BOUNDARY: usize = usize::MAX;

/// A graph of the coarsening: vertex weights, links in rows, and the total weight. The finest
/// borrows the caller's rows; each coarser one owns its own.
struct Level<'g> {
    offsets: Cow<'g, [u32]>,
    adjacency: Cow<'g, [u32]>,
    costs: Cow<'g, [i32]>,
    weights: Vec<i32>,
    total: i64,
}

impl Level<'_> {
    fn len(&self) -> usize {
        self.weights.len()
    }
    fn links(&self) -> usize {
        self.adjacency.len()
    }
    fn degree(&self, v: usize) -> usize {
        (self.offsets[v + 1] - self.offsets[v]) as usize
    }
    fn row(&self, v: usize) -> std::ops::Range<usize> {
        self.offsets[v] as usize..self.offsets[v + 1] as usize
    }
    fn cost(&self, e: usize) -> i64 {
        i64::from(self.costs[e])
    }
    fn weight(&self, v: usize) -> i64 {
        i64::from(self.weights[v])
    }
}

/// The buffers one bisection reuses from level to level, sized for its finest graph.
struct Work {
    queues: [IndexedHeap<Greatest>; 2],
    moved: Vec<bool>,
    swaps: Vec<u32>,
    /// Per coarse vertex, its place in the row being merged (`contract`).
    slot: Vec<usize>,
    row: Vec<(u32, i32)>,
    /// The side of each vertex of the next finer level (`refine`).
    spare: Vec<u8>,
}

/// The balance of a bisection: each side's share of the total, its weight multiplier, and the
/// imbalance allowed.
struct Balance {
    shares: [f32; 2],
    multipliers: [f32; 2],
    tolerance: f32,
}

impl Balance {
    /// How far the heavier side, relative to its share, exceeds the tolerance: at or under zero,
    /// the cut is balanced.
    fn excess(&self, sides: [i64; 2]) -> f32 {
        let mut worst = -1.0f32;
        for s in 0..2 {
            let over = sides[s] as f32 * self.multipliers[s] - self.tolerance;
            if over > worst {
                worst = over;
            }
        }
        worst
    }
    /// Side 0's target weight out of `total`, and side 1's, the rest.
    fn targets(&self, total: i64) -> [i64; 2] {
        let first = (total as f32 * self.shares[0]) as i64;
        [first, total - first]
    }
}

/// The side, 0 or 1, of each vertex of `graph`, side 0 aimed at `shares[0]` of its vertices; the
/// imbalance allowed is `unbalance` thousandths.
pub(super) fn bisect(graph: &Graph, shares: [f32; 2], unbalance: i32) -> Vec<u8> {
    let n = graph.len();
    let mut random = Draws::seeded(SEED);
    let finest = Level {
        offsets: Cow::Borrowed(&graph.offsets[..]),
        adjacency: Cow::Borrowed(&graph.adjacency[..]),
        costs: Cow::Borrowed(&graph.costs[..]),
        weights: vec![1; n],
        total: n as i64,
    };
    let mut work = Work {
        queues: [IndexedHeap::new(n), IndexedHeap::new(n)],
        moved: vec![false; n],
        swaps: Vec::with_capacity(n),
        slot: vec![usize::MAX; n],
        row: Vec::new(),
        spare: Vec::with_capacity(n),
    };
    let tolerance = ((1.0 + 0.001 * unbalance as f64) as f32 as f64 + 0.000_049_9) as f32;
    let inverse = 1.0f32 / n as f32;
    let balance = Balance {
        shares: [shares[0], 1.0 - shares[0]],
        multipliers: [inverse / shares[0], inverse / (1.0 - shares[0])],
        tolerance,
    };
    let (levels, maps) = coarsen(finest, &mut work, &mut random);
    let coarsest = levels.last().expect("one level");
    let tries = if coarsest.len() <= COARSEN_TO {
        TRIES_SMALL
    } else {
        TRIES_LARGE
    };
    let side = grow(coarsest, &balance, tries, &mut work, &mut random);
    refine(&levels, &maps, side, &balance, &mut work, &mut random)
}
