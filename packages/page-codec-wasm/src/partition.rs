//! THE GRAPH PARTITIONER: elements joined by weighted links, cut into parts of about `min` to
//! `max` elements by recursive bisection, each cut a multilevel one (`bisect.rs`: the graph
//! coarsened by heavy-edge matching, cut in two at its coarsest, the cut refined back up), aimed
//! so each side holds a whole number of parts. One partitioner for every cut of the DAG: the
//! triangle clusters (`clusters.rs`: level 0, a reduced group's re-split, the run-time cut) and
//! the compiler's cluster groups (`asset-compiler-rust/src/dag/groups.rs`).
//!
//! Elements no link joins still meet their nearest disjoint neighbours (`locality_links`), weakly,
//! so a part never strings together islands far apart, and a part never waits on a link that
//! does not exist to stay compact.
//!
//! The result is the same on every platform and every thread count: each bisection draws its
//! random numbers from its own fixed seed, every tie breaks by rank, and the parts come out in
//! rank order whatever runs first.
mod bisect;
mod heap;
mod order;

use trillion3d_math::vecn::distance2;

use std::ops::Range;

/// Who runs the two halves of a bisection: one after the other (`Serial`), or side by side on a
/// pool (the compiler's). Each half writes only its own ranks, so the result is the same.
pub trait Fork: Sync {
    fn fork(&self, a: &mut (dyn FnMut() + Send), b: &mut (dyn FnMut() + Send));
}

/// Both halves on the calling thread, the first first.
pub struct Serial;
impl Fork for Serial {
    fn fork(&self, a: &mut (dyn FnMut() + Send), b: &mut (dyn FnMut() + Send)) {
        a();
        b();
    }
}

/// The connected islands of the elements, by union and find: a link joins two elements' islands.
pub struct Islands {
    parent: Vec<u32>,
}
impl Islands {
    pub fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
        }
    }
    /// The island of `i`, every element on the way pointed at it.
    pub fn find(&mut self, i: u32) -> u32 {
        let mut root = i;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut at = i;
        while self.parent[at as usize] != root {
            let next = self.parent[at as usize];
            self.parent[at as usize] = root;
            at = next;
        }
        root
    }
    /// Joins the islands of `a` and `b`, the larger number naming both.
    pub fn union(&mut self, a: u32, b: u32) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            let (low, high) = if ra < rb { (ra, rb) } else { (rb, ra) };
            self.parent[low as usize] = high;
        }
    }
}

/// A graph over the elements in rank order (`Partitioner::ranks`): element of rank `i` links the
/// ranks `adjacency[offsets[i]..offsets[i + 1]]`, each at its cost.
pub struct Graph {
    offsets: Vec<u32>,
    adjacency: Vec<u32>,
    costs: Vec<i32>,
}
impl Graph {
    fn len(&self) -> usize {
        self.offsets.len() - 1
    }
}

/// The longest run of one island along the Morton order whose elements still look for links.
const RUN_FOR_LINKS: usize = 128;
/// The nearest disjoint neighbours an element links, and how far along the Morton order it looks
/// for them on each side.
const LINKS_PER_ELEMENT: usize = 5;
const LINK_STEPS: usize = 16;

/// The partition of `count` elements into parts of `min` to `max`: the elements in part order
/// (`ranks`), and each part's range of it (`parts`).
pub struct Partitioner {
    /// The element at each rank: Morton order once `locality_links` ran, part order once
    /// `partition` did.
    pub ranks: Vec<u32>,
    /// The rank of each element in the Morton order (`locality_links`).
    pub rank_of: Vec<u32>,
    /// Each part as its range of ranks, in rank order.
    pub parts: Vec<Range<usize>>,
    min: usize,
    max: usize,
    /// Each element's locality links, `link_to[link_start[e]..link_start[e + 1]]`, the last made
    /// first.
    link_start: Vec<u32>,
    link_to: Vec<u32>,
}

impl Partitioner {
    pub fn new(count: usize, min: usize, max: usize) -> Self {
        let min = min.max(1);
        Self {
            ranks: (0..count as u32).collect(),
            rank_of: (0..count as u32).collect(),
            parts: Vec::new(),
            min,
            max: max.max(min),
            link_start: vec![0; count + 1],
            link_to: Vec::new(),
        }
    }

    /// Ranks the elements in the Morton order of their `centre` within `bounds` (ties by element),
    /// then links each element of a small island — a run of fewer than `RUN_FOR_LINKS` elements of
    /// one island along that order — to its `LINKS_PER_ELEMENT` nearest elements of other islands
    /// among the next `LINK_STEPS` on each side, a run of its own island skipped whole. Each link
    /// goes both ways, once.
    pub fn locality_links(
        &mut self,
        islands: &mut Islands,
        bounds: ([f32; 3], [f32; 3]),
        centre: impl Fn(u32) -> [f32; 3],
    ) {
        let n = self.ranks.len();
        let (low, high) = bounds;
        let extent = (0..3).map(|a| high[a] - low[a]).fold(0.0f32, f32::max);
        // Each element after its Morton code, ties by element: one sort of whole words.
        let mut keyed: Vec<u64> = (0..n as u32)
            .map(|e| u64::from(morton(centre(e), low, extent)) << 32 | u64::from(e))
            .collect();
        keyed.sort_unstable();
        self.ranks = keyed.iter().map(|&k| k as u32).collect();
        for (rank, &e) in self.ranks.iter().enumerate() {
            self.rank_of[e as usize] = rank as u32;
        }
        let island: Vec<u32> = self.ranks.iter().map(|&e| islands.find(e)).collect();
        // Each rank's run of one island along the order, to jump past an island at once.
        let mut runs = vec![0..0; n];
        let mut start = 0;
        for i in 1..=n {
            if i == n || island[i] != island[start] {
                runs[start..i].fill(start..i);
                start = i;
            }
        }
        // Every link as it is made, both ways: (element, other, when).
        let mut made: Vec<(u32, u32, u32)> = Vec::new();
        for i in 0..n {
            if runs[i].len() >= RUN_FOR_LINKS {
                continue;
            }
            let me = self.ranks[i];
            let here = centre(me);
            let mut nearest = [(u32::MAX, f32::MAX); LINKS_PER_ELEMENT];
            for forward in [false, true] {
                let mut at = i;
                for _ in 0..LINK_STEPS {
                    if forward {
                        if at + 1 >= n {
                            break;
                        }
                        at += 1;
                    } else {
                        if at == 0 {
                            break;
                        }
                        at -= 1;
                    }
                    let other = self.ranks[at];
                    if island[at] == island[i] {
                        at = if forward {
                            runs[at].end - 1
                        } else {
                            runs[at].start
                        };
                        continue;
                    }
                    let mut candidate = (other, distance2(here, centre(other)));
                    for slot in nearest.iter_mut() {
                        if candidate.1 < slot.1 {
                            std::mem::swap(&mut candidate, slot);
                        }
                    }
                }
            }
            for &(other, _) in nearest.iter().filter(|(o, _)| *o != u32::MAX) {
                made.push((me, other, made.len() as u32));
                made.push((other, me, made.len() as u32));
            }
        }
        // A link made twice counts once, when first made; each element's links, the last made
        // first.
        made.sort_unstable();
        made.dedup_by_key(|&mut (e, other, _)| (e, other));
        made.sort_unstable_by_key(|&(e, _, when)| (e, std::cmp::Reverse(when)));
        self.link_start = vec![0; n + 1];
        for &(e, _, _) in &made {
            self.link_start[e as usize + 1] += 1;
        }
        for e in 0..n {
            self.link_start[e + 1] += self.link_start[e];
        }
        self.link_to = made.iter().map(|&(_, other, _)| other).collect();
    }

    /// The graph over the elements in rank order: `links` hands each element's own links, as
    /// (element, cost), about `own_links` in all; its locality links follow at `locality_cost`,
    /// the last made first.
    pub fn graph(
        &self,
        own_links: usize,
        locality_cost: i32,
        mut links: impl FnMut(u32, &mut Vec<(u32, i32)>),
    ) -> Graph {
        let n = self.ranks.len();
        let room = own_links + self.link_to.len();
        let mut graph = Graph {
            offsets: Vec::with_capacity(n + 1),
            adjacency: Vec::with_capacity(room),
            costs: Vec::with_capacity(room),
        };
        let mut own = Vec::new();
        for &e in &self.ranks {
            graph.offsets.push(graph.adjacency.len() as u32);
            own.clear();
            links(e, &mut own);
            for &(other, cost) in &own {
                graph.adjacency.push(self.rank_of[other as usize]);
                graph.costs.push(cost);
            }
            let (from, to) = (self.link_start[e as usize], self.link_start[e as usize + 1]);
            for &other in &self.link_to[from as usize..to as usize] {
                graph.adjacency.push(self.rank_of[other as usize]);
                graph.costs.push(locality_cost);
            }
        }
        graph.offsets.push(graph.adjacency.len() as u32);
        graph
    }

    /// Cuts `graph` in parts of at most `max` elements: a graph over `max` is bisected
    /// (`bisect_graph`), each side aimed at a whole number of parts of the mean of `min` and `max`,
    /// and every side still over `max` bisected again; the halves of a large graph run on `fork`.
    /// The parts come out in rank order.
    pub fn partition(&mut self, graph: Graph, fork: &dyn Fork) {
        let (min, max) = (self.min, self.max);
        self.parts = if self.ranks.is_empty() {
            Vec::new()
        } else {
            recurse(graph, 0, &mut self.ranks, (min, max), fork)
        };
    }
}

/// The halves of a graph over this many elements run on the fork; smaller ones on the caller.
const FORK_ABOVE: usize = 256;

fn recurse(
    graph: Graph,
    offset: usize,
    ranks: &mut [u32],
    sizes: (usize, usize),
    fork: &dyn Fork,
) -> Vec<Range<usize>> {
    let n = ranks.len();
    if n <= sizes.1 {
        return vec![offset..offset + n];
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
/// from `low`, every axis on that one scale; a point outside the bounds, or bounds of no size,
/// clamps to the grid.
fn morton(p: [f32; 3], low: [f32; 3], extent: f32) -> u32 {
    let cell = |a: usize| {
        let unit = if extent > 0.0 {
            (p[a] - low[a]) / extent
        } else {
            0.0
        };
        ((unit * 1023.0) as u32).min(1023)
    };
    spread(cell(0)) | spread(cell(1)) << 1 | spread(cell(2)) << 2
}

/// The ten bits of `x` two bits apart.
fn spread(x: u32) -> u32 {
    let mut x = x & 0x3ff;
    x = (x | x << 16) & 0x0300_00ff;
    x = (x | x << 8) & 0x0300_f00f;
    x = (x | x << 4) & 0x030c_30c3;
    (x | x << 2) & 0x0924_9249
}
