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
//! fixed rule (`heap.rs`, `order.rs`): the same graph cuts the same way wherever and whenever it
//! is cut.
use super::heap::Gains;
use super::order::{sort_by_key_exactly, Draws};
use super::Graph;
use std::borrow::Cow;

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
    queues: [Gains; 2],
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
        queues: [Gains::new(n), Gains::new(n)],
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

// ---------------------------------------------------------------- 1. coarsening

/// The levels from the finest to the coarsest, and for each but the coarsest, its vertices'
/// vertex in the next.
fn coarsen<'g>(
    finest: Level<'g>,
    work: &mut Work,
    random: &mut Draws,
) -> (Vec<Level<'g>>, Vec<Vec<u32>>) {
    let equal_costs = finest.costs.windows(2).all(|w| w[0] == w[1]);
    let heaviest = (1.5 * finest.total as f64 / COARSEN_TO as f64) as i64;
    let mut levels = vec![finest];
    let mut maps = Vec::new();
    let mut first = true;
    loop {
        let graph = levels.last().expect("one level");
        let heaviest_link = !(first && equal_costs) && graph.links() > 0;
        let mut mate = match_vertices(graph, heaviest, heaviest_link, random);
        first = false;
        let (map, coarse) = contract(graph, &mut mate, work);
        let finer = graph.len();
        maps.push(map);
        levels.push(coarse);
        let coarse = levels.last().expect("pushed");
        let more = coarse.len() > COARSEN_TO
            && (coarse.len() as f64) < COARSEN_FRACTION * finer as f64
            && coarse.links() > coarse.len() / 2;
        if !more {
            break;
        }
    }
    (levels, maps)
}

/// The order the matchings visit the vertices in: a shuffle, then a stable counting sort by
/// `⌊√(1 + degree)⌋`, capped at four times the mean degree (itself rounded down).
fn visiting_order(graph: &Level, random: &mut Draws) -> Vec<u32> {
    let n = graph.len();
    let shuffled = random.permutation(n, n / 8);
    let cap = (4.0 * (graph.links() / n) as f64) as usize;
    let key: Vec<usize> = (0..n)
        .map(|v| (((1 + graph.degree(v)) as f64).sqrt() as usize).min(cap))
        .collect();
    let mut start = vec![0usize; cap + 2];
    for &k in &key {
        start[k + 1] += 1;
    }
    for k in 1..start.len() {
        start[k] += start[k - 1];
    }
    let mut order = vec![0u32; n];
    for &v in &shuffled {
        let k = key[v as usize];
        order[start[k]] = v;
        start[k] += 1;
    }
    order
}

/// Matches each vertex, in visiting order, with an unmatched neighbour the pair's weight allows:
/// with `heaviest_link`, the neighbour of the heaviest link (the first on a tie), otherwise the
/// first. A vertex with no link takes the next unmatched vertex of the order; one too light to
/// stay alone that found no partner waits for the matching over two hops.
fn match_vertices(
    graph: &Level,
    heaviest: i64,
    heaviest_link: bool,
    random: &mut Draws,
) -> Vec<u32> {
    let n = graph.len();
    let order = visiting_order(graph, random);
    let mut mate = vec![UNMATCHED; n];
    let mut left = 0usize;
    let mut last_free = 0usize;
    for at in 0..n {
        let i = order[at] as usize;
        if mate[i] != UNMATCHED {
            continue;
        }
        let mut partner = Some(i);
        let w = graph.weight(i);
        if w < heaviest {
            if graph.degree(i) == 0 {
                partner = island_partner(&order, &mate, at, &mut last_free).or(partner);
            } else {
                let mut best = -1i64;
                for e in graph.row(i) {
                    let k = graph.adjacency[e] as usize;
                    if mate[k] == UNMATCHED && w + graph.weight(k) <= heaviest {
                        if !heaviest_link {
                            partner = Some(k);
                            break;
                        }
                        if best < graph.cost(e) {
                            partner = Some(k);
                            best = graph.cost(e);
                        }
                    }
                }
                if partner == Some(i) && 2 * w < heaviest {
                    left += 1;
                    partner = None;
                }
            }
        }
        if let Some(k) = partner {
            mate[i] = k as u32;
            mate[k] = i as u32;
        }
    }
    two_hops(graph, &order, &mut mate, left);
    mate
}

/// A vertex with no link pairs with the next unmatched vertex of the visiting order, whatever
/// its weight; `last_free` remembers how far that search went.
fn island_partner(order: &[u32], mate: &[u32], at: usize, last_free: &mut usize) -> Option<usize> {
    *last_free = (*last_free).max(at) + 1;
    while *last_free < order.len() {
        let j = order[*last_free] as usize;
        if mate[j] == UNMATCHED {
            return Some(j);
        }
        *last_free += 1;
    }
    None
}

/// When too many vertices are left unmatched, pairs them through what they share: two of
/// degree under 2 linking a common vertex, then two of the same links (degree under 64), then,
/// if still too many, degree under 3, then any degree.
fn two_hops(graph: &Level, order: &[u32], mate: &mut [u32], mut left: usize) {
    let n = graph.len() as f64;
    if left as f64 <= UNMATCHED_FOR_TWO_HOPS * n {
        return;
    }
    left = through_common(graph, order, mate, left, 2);
    left = same_links(graph, order, mate, left, 64);
    if left as f64 > 1.5 * UNMATCHED_FOR_TWO_HOPS * n {
        left = through_common(graph, order, mate, left, 3);
    }
    if left as f64 > 2.0 * UNMATCHED_FOR_TWO_HOPS * n {
        through_common(graph, order, mate, left, graph.len());
    }
}

/// Unmatched vertices of degree under `degree`, listed under each vertex they link in visiting
/// order; under each vertex, the first unmatched of its list paired with the last, inwards.
fn through_common(
    graph: &Level,
    order: &[u32],
    mate: &mut [u32],
    mut left: usize,
    degree: usize,
) -> usize {
    let n = graph.len();
    let free = |v: usize, mate: &[u32]| mate[v] == UNMATCHED && graph.degree(v) < degree;
    let mut start = vec![0usize; n + 1];
    for v in 0..n {
        if free(v, mate) {
            for e in graph.row(v) {
                start[graph.adjacency[e] as usize + 1] += 1;
            }
        }
    }
    for v in 1..=n {
        start[v] += start[v - 1];
    }
    let mut fill = start.clone();
    let mut listed = vec![0u32; start[n]];
    for &v in order {
        let v = v as usize;
        if free(v, mate) {
            for e in graph.row(v) {
                let hub = graph.adjacency[e] as usize;
                listed[fill[hub]] = v as u32;
                fill[hub] += 1;
            }
        }
    }
    for &hub in order {
        let (from, to) = (start[hub as usize], start[hub as usize + 1]);
        if to - from < 2 {
            continue;
        }
        let mut last = to;
        let mut j = from;
        while j < last {
            let a = listed[j] as usize;
            if mate[a] == UNMATCHED {
                last -= 1;
                while last > j {
                    let b = listed[last] as usize;
                    if mate[b] == UNMATCHED {
                        mate[a] = b as u32;
                        mate[b] = a as u32;
                        left -= 2;
                        break;
                    }
                    last -= 1;
                }
            }
            j += 1;
        }
    }
    left
}

/// Unmatched vertices of degree 2 to `degree - 1` with the very same neighbours, paired: listed in
/// visiting order, sorted by a key of their neighbours (`sort_by_key_exactly`), each compared with
/// the next ones of its key and degree.
fn same_links(
    graph: &Level,
    order: &[u32],
    mate: &mut [u32],
    mut left: usize,
    degree: usize,
) -> usize {
    let n = graph.len();
    let modulus = (i32::MAX as u64) / degree as u64;
    let mut keyed: Vec<(u64, u32)> = Vec::new();
    for &v in order {
        let d = graph.degree(v as usize);
        if mate[v as usize] == UNMATCHED && d > 1 && d < degree {
            let sum: u64 = graph
                .row(v as usize)
                .map(|e| graph.adjacency[e] as u64 % modulus)
                .sum();
            keyed.push(((sum % modulus) * degree as u64 + d as u64, v));
        }
    }
    sort_by_key_exactly(&mut keyed);
    // Zero to start, like any vertex number: before vertex 0 marks its own neighbours, every
    // unmarked vertex reads as one of them.
    let mut mark = vec![0u32; n];
    for at in 0..keyed.len() {
        let (key, i) = keyed[at];
        let i = i as usize;
        if mate[i] != UNMATCHED {
            continue;
        }
        for e in graph.row(i) {
            mark[graph.adjacency[e] as usize] = i as u32;
        }
        for &(other_key, ii) in &keyed[at + 1..] {
            let ii = ii as usize;
            if mate[ii] != UNMATCHED {
                continue;
            }
            if other_key != key {
                break;
            }
            if graph.degree(i) != graph.degree(ii) {
                break;
            }
            if graph
                .row(ii)
                .all(|e| mark[graph.adjacency[e] as usize] == i as u32)
            {
                mate[i] = ii as u32;
                mate[ii] = i as u32;
                left -= 2;
                break;
            }
        }
    }
    left
}

/// The next graph: each pair one vertex, numbered by its first member, of the pair's weight; its
/// links those of both members (the first's first) to other vertices, merged by vertex in the
/// order first met, costs summed (saturating). With each fine vertex's coarse vertex.
///
/// The pair's link to itself leaves its row. A pair of few links (`FEW_LINKS`, the degree of a
/// vertex matched with itself counted twice) holds that link first, from the start, and the row's
/// last link takes its place; a pair of many leaves the link's own place to the last link.
fn contract<'g>(graph: &Level, mate: &mut [u32], work: &mut Work) -> (Vec<u32>, Level<'g>) {
    let n = graph.len();
    let mut map = vec![0u32; n];
    let mut count = 0u32;
    for i in 0..n {
        if mate[i] == UNMATCHED {
            mate[i] = i as u32;
            map[i] = count;
            count += 1;
        } else if i <= mate[i] as usize {
            map[i] = count;
            map[mate[i] as usize] = count;
            count += 1;
        }
    }
    let count = count as usize;
    let mut offsets = Vec::with_capacity(count + 1);
    let mut adjacency = Vec::with_capacity(graph.links());
    let mut costs = Vec::with_capacity(graph.links());
    let mut weights = Vec::with_capacity(count);
    let Work { slot, row, .. } = work;
    for v in 0..n {
        let u = mate[v] as usize;
        if u < v {
            continue;
        }
        let me = map[v];
        let members: &[usize] = if u == v { &[v] } else { &[v, u] };
        let few = graph.degree(v) + graph.degree(u) < FEW_LINKS;
        row.clear();
        if few {
            slot[me as usize] = 0;
            row.push((me, 0));
        }
        let mut weight = 0i32;
        for &w in members {
            weight += graph.weights[w];
            for e in graph.row(w) {
                let k = map[graph.adjacency[e] as usize];
                match slot[k as usize] {
                    usize::MAX => {
                        slot[k as usize] = row.len();
                        row.push((k, graph.costs[e]));
                    }
                    at => row[at].1 = row[at].1.saturating_add(graph.costs[e]),
                }
            }
        }
        let own = slot[me as usize];
        for &(k, _) in row.iter() {
            slot[k as usize] = usize::MAX;
        }
        if few {
            let last = row.pop().expect("the link to itself");
            if !row.is_empty() {
                row[0] = last;
            }
        } else if own != usize::MAX {
            row.swap_remove(own);
        }
        offsets.push(adjacency.len() as u32);
        weights.push(weight);
        for &(k, cost) in row.iter() {
            adjacency.push(k);
            costs.push(cost);
        }
    }
    offsets.push(adjacency.len() as u32);
    // A coarse graph much smaller than its finer one gives the room back.
    if adjacency.len() > 10_000 && (adjacency.len() as f64) < 0.9 * graph.links() as f64 {
        adjacency.shrink_to_fit();
        costs.shrink_to_fit();
    }
    let coarse = Level {
        offsets: Cow::Owned(offsets),
        adjacency: Cow::Owned(adjacency),
        costs: Cow::Owned(costs),
        weights,
        total: graph.total,
    };
    (map, coarse)
}

// ---------------------------------------------------------------- the cut and its boundary

/// A bisection of one level: each vertex's side, its links' weight to its own side (`inside`) and
/// to the other (`across`), the sides' weights, the weight cut, and the boundary — the vertices
/// with a link across, and those with no link at all — as a list with each member's place.
struct Cut {
    side: Vec<u8>,
    inside: Vec<i64>,
    across: Vec<i64>,
    sides: [i64; 2],
    cut: i64,
    boundary: Vec<u32>,
    place: Vec<usize>,
}

impl Cut {
    /// Everything a side assignment implies, the boundary listed in vertex order.
    fn of(graph: &Level, side: Vec<u8>) -> Self {
        let mut cut = Cut {
            side,
            inside: Vec::new(),
            across: Vec::new(),
            sides: [0; 2],
            cut: 0,
            boundary: Vec::new(),
            place: Vec::new(),
        };
        cut.recount(graph);
        cut
    }
    /// Everything `side` implies on `graph`, the buffers kept.
    fn recount(&mut self, graph: &Level) {
        let n = graph.len();
        self.inside.clear();
        self.inside.resize(n, 0);
        self.across.clear();
        self.across.resize(n, 0);
        self.place.clear();
        self.place.resize(n, NOT_ON_BOUNDARY);
        self.boundary.clear();
        self.sides = [0; 2];
        for v in 0..n {
            self.sides[self.side[v] as usize] += graph.weight(v);
        }
        let mut total = 0;
        for v in 0..n {
            let me = self.side[v];
            let (mut inside, mut across) = (0, 0);
            for e in graph.row(v) {
                if self.side[graph.adjacency[e] as usize] == me {
                    inside += graph.cost(e);
                } else {
                    across += graph.cost(e);
                }
            }
            self.inside[v] = inside;
            self.across[v] = across;
            if across > 0 || graph.degree(v) == 0 {
                self.enter(v);
                total += across;
            }
        }
        self.cut = total / 2;
    }
    fn on_boundary(&self, v: usize) -> bool {
        self.place[v] != NOT_ON_BOUNDARY
    }
    fn enter(&mut self, v: usize) {
        self.place[v] = self.boundary.len();
        self.boundary.push(v as u32);
    }
    /// Leaves the boundary, the list's last member taking its place.
    fn leave(&mut self, v: usize) {
        let at = self.place[v];
        let last = self.boundary.pop().expect("on the boundary");
        if last as usize != v {
            self.boundary[at] = last;
            self.place[last as usize] = at;
        }
        self.place[v] = NOT_ON_BOUNDARY;
    }
    fn gain(&self, v: usize) -> i64 {
        self.across[v] - self.inside[v]
    }
    /// Moves `v` to the other side, its own weights swapped; returns that side.
    fn turn(&mut self, v: usize) -> u8 {
        let to = 1 - self.side[v];
        self.side[v] = to;
        std::mem::swap(&mut self.inside[v], &mut self.across[v]);
        to
    }
    /// Shifts the weights of the neighbour at link `e` of a vertex that just turned to `to`;
    /// returns that neighbour.
    fn shift(&mut self, graph: &Level, e: usize, to: u8) -> usize {
        let k = graph.adjacency[e] as usize;
        let cost = graph.cost(e);
        let shift = if self.side[k] == to { cost } else { -cost };
        self.inside[k] += shift;
        self.across[k] -= shift;
        k
    }
}

// ---------------------------------------------------------------- 2. the coarsest cut

/// The coarsest graph's cut: `tries` times, side 1 holding everything, side 0 grown breadth-first
/// from a random vertex — a random unreached one when the front empties — until side 1 falls to
/// its weight with the tolerance, a vertex that would take side 1 under its weight less the
/// tolerance stopping the growth until another front; then balanced and refined. The cut of
/// least weight, the first on a tie; none at all ends the tries.
fn grow(
    graph: &Level,
    balance: &Balance,
    tries: usize,
    work: &mut Work,
    random: &mut Draws,
) -> Vec<u8> {
    if graph.links() == 0 {
        return random_cut(graph, balance, tries, work, random);
    }
    let n = graph.len();
    let total = graph.total;
    let (most, least) = side_bounds(balance, total);
    let mut best: Option<(i64, Vec<u8>)> = None;
    for _ in 0..tries {
        let mut side = vec![1u8; n];
        let mut reached = vec![false; n];
        let mut sides = [0i64, total];
        let mut queue = Vec::with_capacity(n);
        let start = random.below(n);
        queue.push(start as u32);
        reached[start] = true;
        let mut first = 0usize;
        let mut unreached = n - 1;
        let mut drain = false;
        loop {
            if first == queue.len() {
                if unreached == 0 || drain {
                    break;
                }
                let mut k = random.below(unreached);
                let mut pick = n;
                for (v, &r) in reached.iter().enumerate() {
                    if !r {
                        if k == 0 {
                            pick = v;
                            break;
                        }
                        k -= 1;
                    }
                }
                queue.clear();
                queue.push(pick as u32);
                reached[pick] = true;
                first = 0;
                unreached -= 1;
            }
            let v = queue[first] as usize;
            first += 1;
            if sides[0] > 0 && sides[1] - graph.weight(v) < least {
                drain = true;
                continue;
            }
            side[v] = 0;
            sides[0] += graph.weight(v);
            sides[1] -= graph.weight(v);
            if sides[1] <= most {
                break;
            }
            drain = false;
            for e in graph.row(v) {
                let k = graph.adjacency[e] as usize;
                if !reached[k] {
                    queue.push(k as u32);
                    reached[k] = true;
                    unreached -= 1;
                }
            }
        }
        if sides[1] == 0 {
            side[random.below(n)] = 1;
        }
        if sides[0] == 0 {
            side[random.below(n)] = 0;
        }
        let mut cut = Cut::of(graph, side);
        balance_cut(graph, &mut cut, balance, work, random);
        passes(graph, &mut cut, balance, PASSES, work, random);
        if best
            .as_ref()
            .is_none_or(|(least_cut, _)| cut.cut < *least_cut)
        {
            let done = cut.cut == 0;
            best = Some((cut.cut, cut.side));
            if done {
                break;
            }
        }
    }
    best.expect("one try").1
}

/// The most and the least side 1 may weigh out of `total`, by the tolerance.
fn side_bounds(balance: &Balance, total: i64) -> (i64, i64) {
    let most = (balance.tolerance * total as f32 * balance.shares[1]) as i64;
    let least = (1.0 / balance.tolerance as f64 * total as f64 * balance.shares[1] as f64) as i64;
    (most, least)
}

/// The cut of a graph with no link: the first try everything on side 1, each other a shuffled
/// run of vertices moved to side 0 while it stays under its weight with the tolerance; each
/// balanced and refined (`PASSES_UNLINKED`), the least kept, the first on a tie.
fn random_cut(
    graph: &Level,
    balance: &Balance,
    tries: usize,
    work: &mut Work,
    random: &mut Draws,
) -> Vec<u8> {
    let n = graph.len();
    let most = (balance.tolerance * graph.total as f32 * balance.shares[0]) as i64;
    let mut best: Option<(i64, Vec<u8>)> = None;
    for attempt in 0..tries {
        let mut side = vec![1u8; n];
        if attempt > 0 {
            let order = random.permutation(n, n / 2);
            let mut first = 0;
            for &v in &order {
                let v = v as usize;
                if first + graph.weight(v) < most {
                    side[v] = 0;
                    first += graph.weight(v);
                    if first > most {
                        break;
                    }
                }
            }
        }
        let mut cut = Cut::of(graph, side);
        balance_cut(graph, &mut cut, balance, work, random);
        passes(graph, &mut cut, balance, PASSES_UNLINKED, work, random);
        if best
            .as_ref()
            .is_none_or(|(least_cut, _)| cut.cut < *least_cut)
        {
            let done = cut.cut == 0;
            best = Some((cut.cut, cut.side));
            if done {
                break;
            }
        }
    }
    best.expect("one try").1
}

// ---------------------------------------------------------------- 3. refinement

/// From the coarsest level to the finest: balance and refine, then hand each finer vertex its
/// coarse vertex's side.
fn refine(
    levels: &[Level],
    maps: &[Vec<u32>],
    side: Vec<u8>,
    balance: &Balance,
    work: &mut Work,
    random: &mut Draws,
) -> Vec<u8> {
    let mut at = levels.len() - 1;
    let mut cut = Cut::of(&levels[at], side);
    loop {
        balance_cut(&levels[at], &mut cut, balance, work, random);
        passes(&levels[at], &mut cut, balance, PASSES, work, random);
        if at == 0 {
            return cut.side;
        }
        at -= 1;
        work.spare.clear();
        work.spare
            .extend(maps[at].iter().map(|&c| cut.side[c as usize]));
        std::mem::swap(&mut cut.side, &mut work.spare);
        cut.recount(&levels[at]);
    }
}

/// Moves vertices from the heavier side, the greatest gain first, until the lighter would pass
/// its target; only vertices no heavier than the imbalance move, each once. Skipped when the cut
/// is within the tolerance, or within three mean vertex weights of the target. With a boundary,
/// only boundary vertices move; without, any.
fn balance_cut(
    graph: &Level,
    cut: &mut Cut,
    balance: &Balance,
    work: &mut Work,
    random: &mut Draws,
) {
    if balance.excess(cut.sides) <= 0.0 {
        return;
    }
    let total = graph.total;
    let n = graph.len();
    let off = (balance.shares[0] * total as f32 - cut.sides[0] as f32).abs();
    if off < (3 * total / n as i64) as f32 {
        return;
    }
    let targets = balance.targets(total);
    let gap = (targets[0] - cut.sides[0]).abs();
    let from = if cut.sides[0] < targets[0] { 1u8 } else { 0 };
    let to = 1 - from;
    let boundary_only = !cut.boundary.is_empty();
    let Work { queues, moved, .. } = work;
    let queue = &mut queues[0];
    queue.reset();
    moved[..n].fill(false);
    let movable = |cut: &Cut, moved: &[bool], v: usize| {
        !moved[v] && cut.side[v] == from && graph.weight(v) <= gap
    };
    let candidates: Vec<usize> = if boundary_only {
        let order = random.permutation(cut.boundary.len(), cut.boundary.len() / 5);
        order
            .iter()
            .map(|&i| cut.boundary[i as usize] as usize)
            .collect()
    } else {
        let order = random.permutation(n, n / 5);
        order.iter().map(|&v| v as usize).collect()
    };
    for v in candidates {
        if movable(cut, moved, v) {
            queue.insert(v as u32, cut.gain(v));
        }
    }
    let mut weight_cut = cut.cut;
    for _ in 0..n {
        let Some(v) = queue.pop() else { break };
        let v = v as usize;
        if cut.sides[to as usize] + graph.weight(v) > targets[to as usize] {
            break;
        }
        weight_cut -= cut.gain(v);
        cut.sides[to as usize] += graph.weight(v);
        cut.sides[from as usize] -= graph.weight(v);
        moved[v] = true;
        cut.turn(v);
        if cut.across[v] == 0 && cut.on_boundary(v) && graph.degree(v) > 0 {
            cut.leave(v);
        } else if cut.across[v] > 0 && !cut.on_boundary(v) {
            cut.enter(v);
        }
        for e in graph.row(v) {
            let k = cut.shift(graph, e, to);
            if boundary_only {
                if cut.on_boundary(k) {
                    if cut.across[k] == 0 {
                        cut.leave(k);
                        if movable(cut, moved, k) {
                            queue.remove(k as u32);
                        }
                    } else if movable(cut, moved, k) {
                        queue.update(k as u32, cut.gain(k));
                    }
                } else if cut.across[k] > 0 {
                    cut.enter(k);
                    if movable(cut, moved, k) {
                        queue.insert(k as u32, cut.gain(k));
                    }
                }
            } else {
                if movable(cut, moved, k) {
                    queue.update(k as u32, cut.gain(k));
                }
                if cut.across[k] == 0 && cut.on_boundary(k) {
                    cut.leave(k);
                } else if cut.across[k] > 0 && !cut.on_boundary(k) {
                    cut.enter(k);
                }
            }
        }
    }
    cut.cut = weight_cut;
}

/// Up to `count` passes of Fiduccia and Mattheyses: the boundary vertices queued by gain on their
/// side in a shuffled order, then, from the side further over its target, the best vertex moved,
/// once each, while the cut keeps a chance to improve — a move that lowers the cut within the
/// first imbalance plus a mean vertex weight, or keeps it and narrows the imbalance, is the new
/// best; past `limit` moves without one the pass stops — and every move after the best undone,
/// the last first. A pass that finds nothing better ends the refinement.
fn passes(
    graph: &Level,
    cut: &mut Cut,
    balance: &Balance,
    count: usize,
    work: &mut Work,
    random: &mut Draws,
) {
    let n = graph.len();
    let targets = balance.targets(graph.total);
    let limit = (0.01 * n as f64).clamp(15.0, 100.0) as usize;
    let all = cut.sides[0] + cut.sides[1];
    let mean = (all / 20).min(2 * all / n as i64);
    let first_gap = (targets[0] - cut.sides[0]).abs();
    let Work {
        queues,
        moved,
        swaps,
        ..
    } = work;
    moved[..n].fill(false);
    for _ in 0..count {
        queues[0].reset();
        queues[1].reset();
        swaps.clear();
        let mut best_at: Option<usize> = None;
        let start_cut = cut.cut;
        let mut current = cut.cut;
        let mut best_cut = cut.cut;
        let mut best_gap = (targets[0] - cut.sides[0]).abs();
        let order = random.permutation(cut.boundary.len(), cut.boundary.len());
        for &i in &order {
            let v = cut.boundary[i as usize] as usize;
            queues[cut.side[v] as usize].insert(v as u32, cut.gain(v));
        }
        for step in 0..n {
            let from = if targets[0] - cut.sides[0] < targets[1] - cut.sides[1] {
                0
            } else {
                1
            };
            let to = 1 - from;
            let Some(v) = queues[from].pop() else { break };
            let v = v as usize;
            current -= cut.gain(v);
            cut.sides[to] += graph.weight(v);
            cut.sides[from] -= graph.weight(v);
            let gap = (targets[0] - cut.sides[0]).abs();
            if (current < best_cut && gap <= first_gap + mean)
                || (current == best_cut && gap < best_gap)
            {
                best_cut = current;
                best_gap = gap;
                best_at = Some(step);
            } else if step as isize - best_at.map_or(-1, |b| b as isize) > limit as isize {
                // Past the limit: this last move is not made.
                cut.sides[from] += graph.weight(v);
                cut.sides[to] -= graph.weight(v);
                break;
            }
            moved[v] = true;
            swaps.push(v as u32);
            let to = cut.turn(v);
            if cut.across[v] == 0 && graph.degree(v) > 0 {
                cut.leave(v);
            }
            for e in graph.row(v) {
                let k = cut.shift(graph, e, to);
                let queue = &mut queues[cut.side[k] as usize];
                if cut.on_boundary(k) {
                    if cut.across[k] == 0 {
                        cut.leave(k);
                        if !moved[k] {
                            queue.remove(k as u32);
                        }
                    } else if !moved[k] {
                        queue.update(k as u32, cut.gain(k));
                    }
                } else if cut.across[k] > 0 {
                    cut.enter(k);
                    if !moved[k] {
                        queue.insert(k as u32, cut.gain(k));
                    }
                }
            }
        }
        for &v in swaps.iter() {
            moved[v as usize] = false;
        }
        let keep = best_at.map_or(0, |b| b + 1);
        for &v in swaps[keep..].iter().rev() {
            let v = v as usize;
            let to = cut.turn(v);
            if cut.across[v] == 0 && cut.on_boundary(v) && graph.degree(v) > 0 {
                cut.leave(v);
            } else if cut.across[v] > 0 && !cut.on_boundary(v) {
                cut.enter(v);
            }
            cut.sides[to as usize] += graph.weight(v);
            cut.sides[1 - to as usize] -= graph.weight(v);
            for e in graph.row(v) {
                let k = cut.shift(graph, e, to);
                if cut.on_boundary(k) && cut.across[k] == 0 {
                    cut.leave(k);
                }
                if !cut.on_boundary(k) && cut.across[k] > 0 {
                    cut.enter(k);
                }
            }
        }
        cut.cut = best_cut;
        if best_at.is_none_or(|b| b == 0) || best_cut == start_cut {
            break;
        }
    }
}
