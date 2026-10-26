//! The laying itself (`lay`): where each strip starts and how it grows.

use super::*;

/// `triangles` over vertices named by any number laid in strips (the module's rule), starting
/// where `order` says.
pub(super) fn lay(triangles: &[[u32; 3]], order: Order) -> Lay {
    let n = triangles.len();
    let (vertices, corners) = first_use(triangles.as_flattened().iter().copied());
    let priorities: Vec<f32> = match order {
        Order::Scored(point) => (corners.as_chunks::<3>().0.iter())
            .map(|tri| {
                let [a, b, c] = tri.map(|v| point(vertices[v as usize]));
                a[0] + b[0] + c[0]
            })
            .collect(),
        Order::Given => Vec::new(),
    };
    // Each corner's neighbour across its own edge: the last listed corner of a triangle running
    // that edge back, each taken once. Only the corners of one edge take from the run going the
    // other way, in order, each the next from that run's end.
    let edges = DirectedEdges::of(
        (0..corners.len() as u32)
            .map(|c| (corners[next(c) as usize], corners[prev(c) as usize], c))
            .collect(),
        |edges| edges.sort_unstable(),
    );
    let mut opposite = vec![NONE; n * 3];
    for run in 0..edges.runs() {
        if let Some(back) = edges.back(run) {
            let taken = edges.run(back).iter().rev();
            for (&(_, _, c), &(_, _, o)) in edges.run(run).iter().zip(taken) {
                opposite[c as usize] = o;
            }
        }
    }
    let mut state = Laying {
        corners: &corners,
        opposite: &opposite,
        laid_of: vec![NONE; vertices.len()],
        laid: Vec::new(),
        enabled: vec![true; n],
        triangles: Vec::with_capacity(n),
        strip: Strip::default(),
    };
    let given = matches!(order, Order::Given);
    loop {
        let start = match order {
            Order::Scored(_) => scored_start(&state, &priorities),
            Order::Given => given_start(&state),
        };
        if start == NONE {
            break;
        }
        state.visit(start, true, false);
        let mut current = start;
        while !state.triangles.len().is_multiple_of(RUN) && state.proper((current / 3) as usize) {
            let (left, right) = (
                opposite[next(current) as usize],
                opposite[prev(current) as usize],
            );
            // Given the order, a strip grows only to the triangle that follows.
            let grows = |c: u32| {
                state.open(c)
                    && state.proper((c / 3) as usize)
                    && (!given || (c / 3) as usize == state.triangles.len())
            };
            let mut chosen = None;
            let mut left_score = i32::MIN;
            if grows(left) {
                left_score = state.grown_score(left, true);
                chosen = Some((left, false));
            }
            if grows(right) && state.grown_score(right, false) > left_score {
                chosen = Some((right, true));
            }
            let Some((corner, is_right)) = chosen else {
                break;
            };
            let count = state.laid.len() as u32;
            let [n0, n1, n2] = [next(corner), prev(corner), corner]
                .map(|k| state.laid_of[corners[k as usize] as usize]);
            let fresh = n2 == NONE || count.wrapping_sub(n2) >= WINDOW;
            let after = count + u32::from(fresh);
            if after.wrapping_sub(n0) >= WINDOW || after.wrapping_sub(n1) >= WINDOW {
                break;
            }
            state.visit(corner, false, is_right);
            current = corner;
        }
    }
    let mut strip = std::mem::take(&mut state.strip);
    if strip.masks.len() < MASK_GROUPS {
        strip.masks.resize(MASK_GROUPS, [0; 3]);
    }
    (strip.laid_before, strip.named_before) = strip.packed_counts(n);
    Lay {
        triangles: state.triangles,
        laid: (state.laid.iter()).map(|&v| vertices[v as usize]).collect(),
        strip,
    }
}

/// The corner a strip starts at when the best score decides: over every triangle still to lay in
/// index order and its corners in order, the best score of the window's weights, a tie to the
/// greater sum of x; `NONE` once every triangle is laid.
pub(super) fn scored_start(state: &Laying, priorities: &[f32]) -> u32 {
    let (mut start, mut best, mut best_priority) = (NONE, -1i32, i32::MIN as f32);
    for t in (0..state.enabled.len()).filter(|&t| state.enabled[t]) {
        // A triangle past the window lays new vertices only and scores 0, from any corner.
        let cold = state.cold(t);
        for k in 0..3u32 {
            let c = t as u32 * 3 + k;
            let score = if cold {
                0
            } else {
                let new = state.reach([next(c), prev(c), c].map(|k| state.corners[k as usize]));
                if !new_at_the_end(new) {
                    continue;
                }
                let case = row(
                    true,
                    state.open(state.opposite[c as usize]),
                    state.open(state.opposite[next(c) as usize]),
                    state.open(state.opposite[prev(c) as usize]),
                );
                state.score(t, case)
            };
            if score > best {
                (start, best) = (c, score);
            } else if score == best && priorities[t] > best_priority {
                (start, best_priority) = (c, priorities[t]);
            }
        }
    }
    start
}

/// The corner a strip starts at when the order decides: the first triangle not yet laid, entered
/// by its third corner, as `constrained` lays a start — else, when that leaves a vertex laid
/// before after one laid anew, at the rotation that lays the new ones last.
pub(super) fn given_start(state: &Laying) -> u32 {
    let t = state.triangles.len();
    if t == state.enabled.len() {
        return NONE;
    }
    let base = t as u32 * 3;
    [2, 0, 1]
        .into_iter()
        .map(|k| base + k)
        .find(|&c| {
            new_at_the_end(state.reach([next(c), prev(c), c].map(|k| state.corners[k as usize])))
        })
        .unwrap_or(base + 2)
}

/// Whether the vertices a triangle lays anew (`NONE`) come last of its three, the order a start
/// lays them in: none, the third, the last two, or all.
pub(super) fn new_at_the_end(new: [u32; 3]) -> bool {
    let mask = (0..3).fold(0u32, |m, i| m | u32::from(new[i] == NONE) << i);
    matches!(mask, 0 | 4 | 6 | 7)
}
