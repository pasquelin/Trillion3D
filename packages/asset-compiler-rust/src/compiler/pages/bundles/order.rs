//! The order the page assignment walks a DAG's clusters in (`super::assign_pages`): its groups from
//! the coarsest level to the finest, within a level along a Morton curve over the centres of their
//! LOD balls — the curve read backwards on every other level, so the end of one level lies near the
//! start of the next, and no page depends on a later one —, then each group's clusters along the
//! diagonal of their own balls.
use crate::dag::bounds::points_ball;
use crate::dag::DagCluster;
use rayon::prelude::*;
use trillion3d_page_codec::partition::spread;

/// The cells of the Morton grid along each axis, and the largest cell.
const MORTON_CELLS: f32 = 1023.0;
const MORTON_LAST: i32 = 1023;

/// One group as the walk reads it: its level — its clusters' highest —, the centre of its LOD
/// ball, and its clusters, by DAG slot.
pub(super) struct Walked {
    pub level: usize,
    pub centre: [f64; 3],
    pub members: Vec<usize>,
}

/// The places of `groups` in walk order: the highest level first, then by the Morton code of the
/// LOD ball's centre on a grid of 1 024 cells along the longest side of the box of every centre —
/// each offset from its least corner scaled to that grid and rounded to the nearest cell, every
/// axis on the one scale —, the code's bits flipped on an odd level; ties in their place. In single
/// precision, as the centres are compared.
pub(super) fn walk_order(groups: &[Walked]) -> Vec<usize> {
    let centre = |group: &Walked| group.centre.map(|value| value as f32);
    let (mut low, mut high) = ([f32::MAX; 3], [-f32::MAX; 3]);
    for group in groups {
        let c = centre(group);
        for axis in 0..3 {
            low[axis] = low[axis].min(c[axis]);
            high[axis] = high[axis].max(c[axis]);
        }
    }
    let longest = (0..3)
        .map(|axis| high[axis] - low[axis])
        .fold(f32::MIN, f32::max);
    let scale = MORTON_CELLS / longest;
    let code = |group: &Walked| {
        let c = centre(group);
        // A degenerate box scales by infinity: its centres, all at the least corner, read NaN,
        // which the cast takes to the first cell.
        let cell = |axis: usize| {
            let scaled = (c[axis] - low[axis]) * scale + 0.5;
            (scaled as i32).clamp(0, MORTON_LAST) as u32
        };
        let morton = spread(cell(2)) << 2 | spread(cell(1)) << 1 | spread(cell(0));
        if group.level & 1 != 0 {
            !morton
        } else {
            morton
        }
    };
    let mut keyed: Vec<(std::cmp::Reverse<usize>, u32, usize)> = (groups.iter().enumerate())
        .map(|(at, group)| (std::cmp::Reverse(group.level), code(group), at))
        .collect();
    keyed.sort_unstable();
    keyed.into_iter().map(|(_, _, at)| at).collect()
}

/// Where each cluster of `dag` lies along the diagonal, by slot: the sum of the coordinates of the
/// centre of its own ball (`points_ball` of its vertices over `positions`, never its LOD ball), in
/// single precision. Every cluster is walked once, so each is measured once, side by side on the
/// pool.
pub(super) fn diagonals(dag: &[DagCluster], positions: &[f32]) -> Vec<f32> {
    (dag.par_iter())
        .map(|cluster| {
            let ball = points_ball(positions, &cluster.indices);
            ball[0] as f32 + ball[1] as f32 + ball[2] as f32
        })
        .collect()
}

/// `members`, slots of the DAG, along the diagonal (`diagonals`, `along` by slot), ties in their
/// order.
pub(super) fn along_diagonal(members: &mut [usize], along: &[f32]) {
    let mut keyed: Vec<(f32, usize)> = members.iter().map(|&slot| (along[slot], slot)).collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (member, (_, slot)) in members.iter_mut().zip(keyed) {
        *member = slot;
    }
}
