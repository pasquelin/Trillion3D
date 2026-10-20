//! Coarsening: the visiting order, the matching, island partners and two hops.
use super::super::order::Draws;
use super::contract::{contract, same_links, through_common};
use super::{Level, Work, COARSEN_FRACTION, COARSEN_TO, UNMATCHED, UNMATCHED_FOR_TWO_HOPS};

/// The levels from the finest to the coarsest, and for each but the coarsest, its vertices'
/// vertex in the next.
pub(super) fn coarsen<'g>(
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
