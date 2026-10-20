//! The ghosts a level's reductions hand on (`solved.rs`), routed to the groups of the next level
//! that take one of the outputs of the group that handed them: each to the groups holding the
//! vertex that covers it — both when that vertex lies on their shared border —, else, uncovered
//! or covered by none of their vertices, to the one whose box lies nearest, the first on a tie.
//! A ghost so lands where the surface covering it is simplified next.
use super::*;
use crate::qem::solve::{position_bits, CarriedGhost};
use trillion3d_math::aabb::extend_aabb_f32;
use trillion3d_page_codec::hash::WordSet;

/// A group's vertex positions and box.
struct Taker {
    at: WordSet<[u32; 3]>,
    low: [f32; 3],
    high: [f32; 3],
}

impl Taker {
    /// The group of slots `group`, its clusters' lists `lists` over `positions`.
    fn of(positions: &[f32], lists: &[&[u32]], group: &[usize]) -> Self {
        let mut taker = Taker {
            at: WordSet::default(),
            low: [f32::INFINITY; 3],
            high: [f32::NEG_INFINITY; 3],
        };
        for &v in group.iter().flat_map(|&slot| lists[slot]) {
            let p: [f32; 3] = std::array::from_fn(|a| positions[v as usize * 3 + a]);
            taker.at.insert(position_bits(p));
            extend_aabb_f32(&mut taker.low, &mut taker.high, p);
        }
        taker
    }

    /// The squared distance from `p` to its box.
    fn distance2(&self, p: [f32; 3]) -> f32 {
        (0..3)
            .map(|a| {
                (self.low[a] - p[a])
                    .max(0.0)
                    .max(p[a] - self.high[a])
                    .powi(2)
            })
            .sum()
    }
}

/// The ghosts of `handed`, by the group that handed them on, routed to the `groups` of a level,
/// whose slots hold the clusters of `lists` over `positions` made by the groups of `sources`;
/// `handed` is left empty, nothing in it kept past the level.
pub(super) fn route(
    positions: &[f32],
    lists: &[&[u32]],
    sources: &[Option<usize>],
    groups: &[Vec<usize>],
    handed: &mut [Vec<CarriedGhost>],
) -> Vec<Vec<CarriedGhost>> {
    let mut out = vec![Vec::new(); groups.len()];
    // Each group that hands ghosts on and each group taking one of its outputs.
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for (taker, group) in groups.iter().enumerate() {
        pairs.extend(
            group
                .iter()
                .filter_map(|&slot| sources[slot])
                .map(|s| (s, taker)),
        );
    }
    pairs.sort_unstable();
    pairs.dedup();
    let mut takers: Vec<Option<Taker>> = (0..groups.len()).map(|_| None).collect();
    for run in pairs.chunk_by(|a, b| a.0 == b.0) {
        let ghosts = std::mem::take(&mut handed[run[0].0]);
        if ghosts.is_empty() {
            continue;
        }
        for &(_, taker) in run {
            takers[taker].get_or_insert_with(|| Taker::of(positions, lists, &groups[taker]));
        }
        let taker = |t: usize| takers[t].as_ref().expect("a taker built");
        for ghost in ghosts {
            let cover = ghost.cover.map(position_bits);
            let mut placed = false;
            for &(_, t) in run {
                if cover.is_some_and(|key| taker(t).at.contains(&key)) {
                    out[t].push(ghost);
                    placed = true;
                }
            }
            if !placed {
                let nearest = (run.iter().map(|&(_, t)| (taker(t).distance2(ghost.p), t))).fold(
                    (f32::INFINITY, run[0].1),
                    |a, b| if b.0 < a.0 { b } else { a },
                );
                out[nearest.1].push(ghost);
            }
        }
    }
    handed.iter_mut().for_each(|list| *list = Vec::new());
    out
}
