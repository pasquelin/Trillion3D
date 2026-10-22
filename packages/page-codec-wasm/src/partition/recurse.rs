//! The recursion over the parts, the bisection of a graph and the Morton order of its elements.
use super::{bisect, Fork, Graph};
use std::ops::Range;

/// The halves of a graph over this many elements run on the fork; smaller ones on the caller.
const FORK_ABOVE: usize = 256;

pub(super) fn recurse(
    graph: Graph,
    offset: usize,
    ranks: &mut [u32],
    sizes: (usize, usize),
    fork: &dyn Fork,
) -> Vec<Range<usize>> {
    let n = ranks.len();
    if n <= sizes.1 {
        return std::iter::once(offset..offset + n).collect();
    }
    let (split, children) = bisect_graph(graph, ranks, sizes);
    let Some((first, second)) = children else {
        return vec![offset..offset + split, offset + split..offset + n];
    };
    let (a, b) = ranks.split_at_mut(split);
    let (mut first, mut second) = (Some(first), Some(second));
    let (mut left, mut right) = (Vec::new(), Vec::new());
    let mut run_a = || left = recurse(first.take().expect("once"), offset, a, sizes, fork);
    let mut run_b =
        || right = recurse(second.take().expect("once"), offset + split, b, sizes, fork);
    if split > FORK_ABOVE {
        fork.fork(&mut run_a, &mut run_b);
    } else {
        run_a();
        run_b();
    }
    left.extend(right);
    left
}

/// One bisection of `graph`, whose rank `i` is `ranks[i]`: the sides' weights `⌊k/2⌋/k` and the
/// rest, `k` the parts of the mean size the graph makes (two at least, rounded to the nearest);
/// the balance loose (20 %) when `k` reaches 128 or `max` is twice `min` or more, near-exact
/// (0.1 %) otherwise. The ranks are divided in place — the first side's kept in order from the front, the
/// second's from the back — and the side of the split returned, with the two sides' graphs when
/// one still holds more than `max`.
fn bisect_graph(
    graph: Graph,
    ranks: &mut [u32],
    (min, max): (usize, usize),
) -> (usize, Option<(Graph, Graph)>) {
    let n = graph.len();
    let target = (min + max) / 2;
    let parts = ((n + target / 2) / target).max(2);
    let first = (parts / 2) as f32 / parts as f32;
    let loose = parts >= 128 || max / min > 1;
    let side = bisect::bisect(&graph, [first, 1.0 - first], if loose { 200 } else { 1 });
    // The new rank of each old one, an involution: a swap moves two at once.
    let mut moved: Vec<usize> = (0..n).collect();
    let (mut front, mut back) = (0usize, n);
    loop {
        while front < back && side[front] == 0 {
            front += 1;
        }
        while front < back && side[back - 1] == 1 {
            back -= 1;
        }
        if back - front < 2 {
            break;
        }
        ranks.swap(front, back - 1);
        moved.swap(front, back - 1);
        front += 1;
        back -= 1;
    }
    let mut split = front;
    if split == 0 || split == n {
        // A side left empty, which a bisection never returns: the cut falls at the first side's
        // weight in rank order, so the recursion still ends.
        split = ((n as f32 * first) as usize).clamp(1, n - 1);
        moved = (0..n).collect();
    }
    let sizes = [split, n - split];
    if sizes[0] <= max && sizes[1] <= max {
        return (split, None);
    }
    let mut children = [0, 1].map(|c| Graph {
        offsets: Vec::with_capacity(sizes[c] + 1),
        adjacency: Vec::with_capacity(graph.adjacency.len() / 2),
        costs: Vec::with_capacity(graph.adjacency.len() / 2),
    });
    for i in 0..n {
        let (c, base) = if i < split { (0, 0) } else { (1, split) };
        let child = &mut children[c];
        child.offsets.push(child.adjacency.len() as u32);
        let old = moved[i];
        for e in graph.offsets[old] as usize..graph.offsets[old + 1] as usize {
            let to = moved[graph.adjacency[e] as usize];
            if (base..base + sizes[c]).contains(&to) {
                child.adjacency.push((to - base) as u32);
                child.costs.push(graph.costs[e]);
            }
        }
    }
    let [a, b] = children.map(|mut child| {
        child.offsets.push(child.adjacency.len() as u32);
        child
    });
    (split, Some((a, b)))
}

/// The 30-bit Morton code of `p` on a grid of 1 024 cells along the longest side of the bounds
/// from `low`, every axis on that one scale: each offset from `low` divided by `extent`, that
/// longest side (a division, not a product by its reciprocal: one rounding), 0 for bounds of no
/// size; a point outside the bounds, or bounds of no size, clamps to the grid.
pub(super) fn morton(p: [f32; 3], low: [f32; 3], extent: f32) -> u32 {
    let cell = |a: usize| {
        let unit = if extent > 0.0 {
            (p[a] - low[a]) / extent
        } else {
            0.0
        };
        ((unit * 1023.0) as u32).min(1023)
    };
    morton3([cell(0), cell(1), cell(2)])
}

/// The 30-bit Morton code of `cell`, three cells of 10 bits (`spread` masks the rest): `x` in the
/// lowest bit of each triple, then `y`, then `z`. Here, in the compiler's page assignment
/// (`asset-compiler-rust/src/compiler/pages/bundles/order.rs`) and in its voxel rays.
pub fn morton3(cell: [u32; 3]) -> u32 {
    spread(cell[0]) | spread(cell[1]) << 1 | spread(cell[2]) << 2
}

/// The ten bits of `x` two bits apart: one axis of a 30-bit Morton code.
pub fn spread(x: u32) -> u32 {
    let mut x = x & 0x3ff;
    x = (x | x << 16) & 0x0300_00ff;
    x = (x | x << 8) & 0x0300_f00f;
    x = (x | x << 4) & 0x030c_30c3;
    (x | x << 2) & 0x0924_9249
}
