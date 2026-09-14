use super::*;

pub fn group_clusters(
    centres: &[[f64; 3]],
    adjacency: &[Vec<(u32, u32)>],
    max: usize,
) -> Vec<Vec<usize>> {
    let mut groups = Vec::new();
    let mut side = vec![0u8; centres.len()];
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
        let mut min = [f64::INFINITY; 3];
        let mut max_bound = [f64::NEG_INFINITY; 3];
        for &m in slice.iter() {
            for a in 0..3 {
                min[a] = min[a].min(centres[m][a]);
                max_bound[a] = max_bound[a].max(centres[m][a]);
            }
        }
        let mut axis = 0;
        for a in 1..3 {
            if max_bound[a] - min[a] > max_bound[axis] - min[axis] {
                axis = a;
            }
        }
        slice.sort_unstable_by(|&a, &b| {
            centres[a][axis]
                .total_cmp(&centres[b][axis])
                .then(a.cmp(&b))
        });
        let middle = len / 2;
        for (i, &m) in slice.iter().enumerate() {
            side[m] = if i < middle { 0 } else { 1 };
        }
        refine_bisection(slice, &mut side, adjacency, len * 3 / 8);
        slice.sort_unstable_by_key(|&m| (side[m], m));
        let split = from + slice.iter().filter(|&&m| side[m] == 0).count();
        stack.push((from, split));
        stack.push((split, to));
    }
    groups.sort_unstable_by_key(|group| group.first().copied().unwrap_or(usize::MAX));
    groups
}

pub(super) fn refine_bisection(
    slice: &mut [usize],
    side: &mut [u8],
    adjacency: &[Vec<(u32, u32)>],
    floor: usize,
) {
    let mut present: std::collections::HashSet<usize> =
        std::collections::HashSet::with_capacity(slice.len());
    for &m in slice.iter() {
        present.insert(m);
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
                if !present.contains(&(other as usize)) {
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
}

// ---------------------------------------------------------------- group reduction

pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let positions = input.positions;
    let mut merged = Vec::new();
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = u32::MAX;
    for child in children {
        merged.extend_from_slice(&child.indices);
        spheres.push(child.sphere);
        child_error = child_error.max(child.lod_error);
        source_rank = source_rank.min(child.source_rank);
    }
    let sphere = enclosing_sphere(&spheres);
    let triangles = merged.len() / 3;
    if triangles < 2 {
        return Ok(Err(GroupOutcome::TooSmall));
    }
    let locks = input.locks;
    let simplified = {
        let _t = Timer::new(&PHASES.simplify);
        simplify_with_locked_vertices(
            positions,
            &merged,
            triangles / 2,
            SIMPLIFY_ERROR_CEILING,
            &|vertex| locks.get(vertex as usize).copied().unwrap_or(true),
        )?
    };
    if simplified.triangles >= triangles || simplified.indices.is_empty() {
        return Ok(Err(GroupOutcome::NoCollapse));
    }
    // Every vertex shared with another group must survive, or the two groups no longer meet.
    let weld = input.weld;
    let required: std::collections::HashSet<u32> = merged
        .iter()
        .filter(|&&id| locks.get(id as usize).copied().unwrap_or(false))
        .map(|&id| weld[id as usize])
        .collect();
    if !required.is_empty() {
        let kept: std::collections::HashSet<u32> = simplified
            .indices
            .iter()
            .map(|&id| weld[id as usize])
            .collect();
        if !required.iter().all(|id| kept.contains(id)) {
            return Ok(Err(GroupOutcome::BorderLost));
        }
    }
    let error = simplified.error_object.max(child_error);
    if !error.is_finite() {
        return Ok(Err(GroupOutcome::UnusableError));
    }
    let clusters = {
        let _t = Timer::new(&PHASES.resplit);
        cluster_triangles(positions, &simplified.indices, DAG_CLUSTER_TRIANGLES)?
    };
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters,
        source_rank,
    }))
}
