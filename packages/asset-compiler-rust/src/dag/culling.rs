use super::*;
use crate::shared_math::{bisect_centres, merge_aabb};

/// Bornes d'un nœud : la boîte de ses clusters, la sphère qui enferme leurs sphères de remplacement
/// et la plus grande erreur de remplacement du sous-arbre. Une seule lecture de l'intervalle sert
/// aussi bien à la racine, qui couvre tout l'ordre, qu'à un nœud qui n'en couvre qu'une tranche.
fn node_bounds(
    span: &[usize],
    boxes: &[([f64; 3], [f64; 3])],
    clusters: &[DagCluster],
) -> ([f64; 3], [f64; 3], [f64; 4], f64) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    let mut spheres = Vec::with_capacity(span.len());
    let mut max_parent_error = 0.0_f64;
    for &id in span {
        let (bmin, bmax) = boxes[id];
        merge_aabb(&mut min, &mut max, bmin, bmax);
        spheres.push(clusters[id].parent_sphere);
        if clusters[id].parent_error > max_parent_error {
            max_parent_error = clusters[id].parent_error;
        }
    }
    (min, max, enclosing_sphere(&spheres), max_parent_error)
}

pub fn build_culling_bvh(
    positions: &[f32],
    clusters: &[DagCluster],
) -> (Vec<usize>, Vec<CullingNode>) {
    let mut order: Vec<usize> = (0..clusters.len()).collect();
    let mut nodes: Vec<CullingNode> = Vec::new();
    if clusters.is_empty() {
        return (order, nodes);
    }
    let boxes: Vec<([f64; 3], [f64; 3])> = clusters
        .iter()
        .map(|cluster| cluster_bounds(positions, &cluster.indices))
        .collect();
    let centres: Vec<[f64; 3]> = boxes
        .iter()
        .map(|(min, max)| {
            [
                (min[0] + max[0]) * 0.5,
                (min[1] + max[1]) * 0.5,
                (min[2] + max[2]) * 0.5,
            ]
        })
        .collect();
    order.sort_unstable_by_key(|&id| (clusters[id].level, id));
    let mut level_ranges = Vec::new();
    let mut start = 0usize;
    while start < order.len() {
        let level = clusters[order[start]].level;
        let mut end = start + 1;
        while end < order.len() && clusters[order[end]].level == level {
            end += 1;
        }
        level_ranges.push((start, end));
        start = end;
    }
    nodes.push(CullingNode::default());
    let mut queue = std::collections::VecDeque::new();
    if level_ranges.len() < 2 {
        queue.push_back((0usize, 0usize, clusters.len()));
    } else {
        let first_child = 1usize;
        nodes[0].first_child = first_child;
        nodes[0].child_count = level_ranges.len();
        nodes.resize(first_child + level_ranges.len(), CullingNode::default());
        for (offset, &(from, to)) in level_ranges.iter().enumerate() {
            queue.push_back((first_child + offset, from, to));
        }
        let (min, max, sphere, max_parent_error) = node_bounds(&order, &boxes, clusters);
        nodes[0].min = min;
        nodes[0].max = max;
        nodes[0].sphere = sphere;
        nodes[0].max_parent_error = max_parent_error;
    }
    while let Some((index, start, end)) = queue.pop_front() {
        let (min, max, sphere, max_parent_error) = node_bounds(&order[start..end], &boxes, clusters);
        nodes[index].min = min;
        nodes[index].max = max;
        nodes[index].sphere = sphere;
        nodes[index].max_parent_error = max_parent_error;
        if end - start <= CULLING_LEAF {
            nodes[index].first_cluster = start;
            nodes[index].cluster_count = end - start;
            continue;
        }
        // Three median splits on the longest axis give the eight children.
        let mut ranges = vec![(start, end)];
        for _ in 0..CULLING_BRANCHING.trailing_zeros() {
            let mut next = Vec::with_capacity(ranges.len() * 2);
            for (from, to) in ranges {
                if to - from < 2 {
                    next.push((from, to));
                    continue;
                }
                bisect_centres(&mut order[from..to], &centres);
                let middle = from + (to - from) / 2;
                next.push((from, middle));
                next.push((middle, to));
            }
            ranges = next;
        }
        let ranges: Vec<(usize, usize)> =
            ranges.into_iter().filter(|(from, to)| to > from).collect();
        let first_child = nodes.len();
        nodes[index].first_child = first_child;
        nodes[index].child_count = ranges.len();
        nodes.resize(first_child + ranges.len(), CullingNode::default());
        for (offset, (from, to)) in ranges.into_iter().enumerate() {
            queue.push_back((first_child + offset, from, to));
        }
    }
    (order, nodes)
}
