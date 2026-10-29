//! The refinement passes that move boundary vertices by gain.
use super::super::order::Draws;
use super::cut::Cut;
use super::{Balance, Level, Work};

/// Up to `count` passes of Fiduccia and Mattheyses: the boundary vertices queued by gain on their
/// side in a shuffled order, then, from the side further over its target, the best vertex moved,
/// once each, while the cut keeps a chance to improve — a move that lowers the cut within the
/// first imbalance plus a mean vertex weight, or keeps it and narrows the imbalance, is the new
/// best; past `limit` moves without one the pass stops — and every move after the best undone,
/// the last first. A pass that finds nothing better ends the refinement.
pub(super) fn passes(
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
            queues[cut.side[v] as usize].insert(v as u32, cut.gain(v) as f32);
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
                        queue.update(k as u32, cut.gain(k) as f32);
                    }
                } else if cut.across[k] > 0 {
                    cut.enter(k);
                    if !moved[k] {
                        queue.insert(k as u32, cut.gain(k) as f32);
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
            cut.settle(graph, v);
            cut.sides[to as usize] += graph.weight(v);
            cut.sides[1 - to as usize] -= graph.weight(v);
            for e in graph.row(v) {
                let k = cut.shift(graph, e, to);
                cut.settle(graph, k);
            }
        }
        cut.cut = best_cut;
        if best_at.is_none_or(|b| b == 0) || best_cut == start_cut {
            break;
        }
    }
}
