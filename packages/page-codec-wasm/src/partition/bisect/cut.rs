//! A cut and its growth from a seed.
use super::super::order::Draws;
use super::passes::passes;
use super::refine::{balance_cut, random_cut, side_bounds};
use super::{Balance, Level, Work, NOT_ON_BOUNDARY, PASSES};

/// A bisection of one level: each vertex's side, its links' weight to its own side (`inside`) and
/// to the other (`across`), the sides' weights, the weight cut, and the boundary — the vertices
/// with a link across, and those with no link at all — as a list with each member's place.
pub(super) struct Cut {
    pub(super) side: Vec<u8>,
    pub(super) inside: Vec<i64>,
    pub(super) across: Vec<i64>,
    pub(super) sides: [i64; 2],
    pub(super) cut: i64,
    pub(super) boundary: Vec<u32>,
    pub(super) place: Vec<usize>,
}

impl Cut {
    /// Everything a side assignment implies, the boundary listed in vertex order.
    pub(super) fn of(graph: &Level, side: Vec<u8>) -> Self {
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
    pub(super) fn recount(&mut self, graph: &Level) {
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
    pub(super) fn on_boundary(&self, v: usize) -> bool {
        self.place[v] != NOT_ON_BOUNDARY
    }
    pub(super) fn enter(&mut self, v: usize) {
        self.place[v] = self.boundary.len();
        self.boundary.push(v as u32);
    }
    /// Leaves the boundary, the list's last member taking its place.
    pub(super) fn leave(&mut self, v: usize) {
        let at = self.place[v];
        let last = self.boundary.pop().expect("on the boundary");
        if last as usize != v {
            self.boundary[at] = last;
            self.place[last as usize] = at;
        }
        self.place[v] = NOT_ON_BOUNDARY;
    }
    pub(super) fn gain(&self, v: usize) -> i64 {
        self.across[v] - self.inside[v]
    }
    /// Moves `v` to the other side, its own weights swapped; returns that side.
    pub(super) fn turn(&mut self, v: usize) -> u8 {
        let to = 1 - self.side[v];
        self.side[v] = to;
        std::mem::swap(&mut self.inside[v], &mut self.across[v]);
        to
    }
    /// Shifts the weights of the neighbour at link `e` of a vertex that just turned to `to`;
    /// returns that neighbour.
    pub(super) fn shift(&mut self, graph: &Level, e: usize, to: u8) -> usize {
        let k = graph.adjacency[e] as usize;
        let cost = graph.cost(e);
        let shift = if self.side[k] == to { cost } else { -cost };
        self.inside[k] += shift;
        self.across[k] -= shift;
        k
    }
}

/// The coarsest graph's cut: `tries` times, side 1 holding everything, side 0 grown breadth-first
/// from a random vertex — a random unreached one when the front empties — until side 1 falls to
/// its weight with the tolerance, a vertex that would take side 1 under its weight less the
/// tolerance stopping the growth until another front; then balanced and refined. The cut of
/// least weight, the first on a tie; none at all ends the tries.
pub(super) fn grow(
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
