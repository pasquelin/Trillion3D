//! The side bounds, a random cut, refinement and balance.
use super::super::order::Draws;
use super::cut::Cut;
use super::passes::passes;
use super::{Balance, Level, Work, PASSES, PASSES_UNLINKED};

/// The most and the least side 1 may weigh out of `total`, by the tolerance.
pub(super) fn side_bounds(balance: &Balance, total: i64) -> (i64, i64) {
    let most = (balance.tolerance * total as f32 * balance.shares[1]) as i64;
    let least = (1.0 / balance.tolerance as f64 * total as f64 * balance.shares[1] as f64) as i64;
    (most, least)
}

/// One try of a cut: the sides `side` of `graph` balanced and refined in `count` passes, kept in
/// `best` where they cut less than the least so far. Whether they cut nothing, so that no later
/// try can do better.
pub(super) fn keep_least(
    graph: &Level,
    side: Vec<u8>,
    (balance, count): (&Balance, usize),
    work: &mut Work,
    random: &mut Draws,
    best: &mut Option<(i64, Vec<u8>)>,
) -> bool {
    let mut cut = Cut::of(graph, side);
    balance_cut(graph, &mut cut, balance, work, random);
    passes(graph, &mut cut, balance, count, work, random);
    let better = best
        .as_ref()
        .is_none_or(|(least_cut, _)| cut.cut < *least_cut);
    let done = better && cut.cut == 0;
    if better {
        *best = Some((cut.cut, cut.side));
    }
    done
}

/// The cut of a graph with no link: the first try everything on side 1, each other a shuffled
/// run of vertices moved to side 0 while it stays under its weight with the tolerance; each
/// balanced and refined (`PASSES_UNLINKED`), the least kept, the first on a tie.
pub(super) fn random_cut(
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
        if keep_least(
            graph,
            side,
            (balance, PASSES_UNLINKED),
            work,
            random,
            &mut best,
        ) {
            break;
        }
    }
    best.expect("one try").1
}

/// From the coarsest level to the finest: balance and refine, then hand each finer vertex its
/// coarse vertex's side.
pub(super) fn refine(
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
            queue.insert(v as u32, cut.gain(v) as f32);
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
                        queue.update(k as u32, cut.gain(k) as f32);
                    }
                } else if cut.across[k] > 0 {
                    cut.enter(k);
                    if movable(cut, moved, k) {
                        queue.insert(k as u32, cut.gain(k) as f32);
                    }
                }
            } else {
                if movable(cut, moved, k) {
                    queue.update(k as u32, cut.gain(k) as f32);
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
