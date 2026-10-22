//! The crossings of the grid's edges, found by bisection all at once: each step's midpoints of
//! every edge still searching read in one list.
use super::super::marching::settled_crossing;
use super::super::SEARCH_STEPS;
use super::Implicit;
use rayon::prelude::*;

/// The two ends of the interval an edge's crossing lies in.
type Bracket = ([f64; 3], [f64; 3]);

fn middle(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|k| (a[k] + b[k]) * 0.5)
}

/// The crossing of `threshold` on each edge of `ends` — its ends and their values —, three floats
/// per edge, found by bisection — the winding number jumps rather than varies linearly, so
/// interpolating the two values would misplace it: the middle when both values match, an end
/// nudged towards the other when its value is the threshold, else `SEARCH_STEPS` bisections of
/// `implicit` from the lower value and the last bracket's middle.
pub(super) fn crossings(
    ends: Vec<([f64; 3], f64, [f64; 3], f64)>,
    threshold: f64,
    implicit: &mut Implicit,
) -> crate::Result<Vec<f32>> {
    // Each edge's bracket, low value first, or its crossing when no search is needed.
    let (mut brackets, settled): (Vec<Bracket>, Vec<bool>) = (ends.par_iter())
        .map(|&(p1, v1, p2, v2)| {
            if let Some(p) = settled_crossing((p1, v1), (p2, v2), threshold) {
                return ((p, p), true);
            }
            (if v2 < v1 { (p2, p1) } else { (p1, p2) }, false)
        })
        .unzip();
    drop(ends);
    let searching: Vec<usize> = (0..brackets.len()).filter(|&e| !settled[e]).collect();
    for _ in 0..SEARCH_STEPS {
        let middles: Vec<[f64; 3]> = (searching.par_iter())
            .map(|&e| middle(brackets[e].0, brackets[e].1))
            .collect();
        let values = implicit(&middles)?;
        for ((&e, m), v) in searching.iter().zip(middles).zip(values) {
            if f64::from(v) < threshold {
                brackets[e].0 = m;
            } else {
                brackets[e].1 = m;
            }
        }
    }
    Ok((brackets.par_iter())
        .flat_map_iter(|&(a, b)| middle(a, b).map(|x| x as f32))
        .collect())
}
