//! Contraction: common neighbours, same links, the contracted level.
use super::super::order::sort_by_key_exactly;
use super::{Level, Work, FEW_LINKS, UNMATCHED};
use std::borrow::Cow;

/// Unmatched vertices of degree under `degree`, listed under each vertex they link in visiting
/// order; under each vertex, the first unmatched of its list paired with the last, inwards.
pub(super) fn through_common(
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
pub(super) fn same_links(
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
pub(super) fn contract<'g>(
    graph: &Level,
    mate: &mut [u32],
    work: &mut Work,
) -> (Vec<u32>, Level<'g>) {
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
