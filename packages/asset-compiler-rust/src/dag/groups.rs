use trillion3d_page_codec::split::{bisect_least_cost, sort_along};

/// Groups of at most `max` clusters, each cluster given by its bounding sphere: the median split
/// of every tree over boxed things (`bisect_least_cost`, the spheres' boxes weighed), each cut then
/// refined along the clusters' shared edges.
pub fn group_clusters(
    spheres: &[[f64; 4]],
    adjacency: &[Vec<(u32, u32)>],
    max: usize,
) -> Vec<Vec<usize>> {
    let centres: Vec<[f64; 3]> = spheres.iter().map(|s| [s[0], s[1], s[2]]).collect();
    let bounds = |id: usize| {
        let [x, y, z, r] = spheres[id];
        ([x - r, y - r, z - r], [x + r, y + r, z + r])
    };
    let mut groups = Vec::new();
    let mut side = vec![0u8; centres.len()];
    // Single membership table for all cuts: cleared on entry each call.
    let mut present = vec![false; centres.len()];
    let mut members: Vec<usize> = (0..centres.len()).collect();
    let mut stack = vec![(0usize, members.len())];
    while let Some((from, to)) = stack.pop() {
        let len = to - from;
        if len == 0 {
            continue;
        }
        if len <= max {
            groups.push(members[from..to].to_vec());
            continue;
        }
        let slice = &mut members[from..to];
        let middle = len / 2;
        let axis = bisect_least_cost(slice, &centres, bounds, middle);
        // The refinement visits the members in their order on the axis: each half sorted on it,
        // the order a full sort of the group gives.
        sort_along(&mut slice[..middle], &centres, axis);
        sort_along(&mut slice[middle..], &centres, axis);
        for (i, &m) in slice.iter().enumerate() {
            side[m] = if i < middle { 0 } else { 1 };
        }
        refine_bisection(slice, &mut side, adjacency, len * 3 / 8, &mut present);
        slice.sort_unstable_by_key(|&m| (side[m], m));
        let split = from + slice.iter().filter(|&&m| side[m] == 0).count();
        stack.push((from, split));
        stack.push((split, to));
    }
    groups.sort_unstable_by_key(|group| group.first().copied().unwrap_or(usize::MAX));
    groups
}

/// `present` arrives and leaves entirely `false`: cut marks only own members,
/// replacing per-call reconstructed `HashSet` with reused indexed table.
pub(crate) fn refine_bisection(
    slice: &[usize],
    side: &mut [u8],
    adjacency: &[Vec<(u32, u32)>],
    floor: usize,
    present: &mut [bool],
) {
    for &m in slice.iter() {
        present[m] = true;
    }
    let mut counts = [0usize; 2];
    for &m in slice.iter() {
        counts[side[m] as usize] += 1;
    }
    for _ in 0..2 {
        let mut moved = false;
        for &m in slice.iter() {
            let here = side[m] as usize;
            if counts[here] <= floor {
                continue;
            }
            let mut internal = 0i64;
            let mut external = 0i64;
            for &(other, weight) in adjacency.get(m).map(|v| v.as_slice()).unwrap_or(&[]) {
                if !present.get(other as usize).copied().unwrap_or(false) {
                    continue;
                }
                if side[other as usize] as usize == here {
                    internal += weight as i64;
                } else {
                    external += weight as i64;
                }
            }
            if external > internal {
                side[m] = 1 - side[m];
                counts[here] -= 1;
                counts[1 - here] += 1;
                moved = true;
            }
        }
        if !moved {
            break;
        }
    }
    for &m in slice.iter() {
        present[m] = false;
    }
}
