use super::*;

/// Displaced grid: a manifold sheet with enough detail that simplification has work to do.
pub(crate) fn grid(n: usize) -> (Vec<f32>, Vec<u32>) {
    let w = n + 1;
    let mut positions = Vec::with_capacity(w * w * 3);
    for y in 0..w {
        for x in 0..w {
            let fx = x as f32;
            let fy = y as f32;
            positions.extend([fx, fy, (fx * 0.31).sin() * (fy * 0.27).cos() * 2.0]);
        }
    }
    let indices = crate::tests::fixtures::grid_indices(n, n, |x, y| (y * w + x) as u32);
    (positions, indices)
}

/// Full mesh DAG, no UVs, no cancel point.
pub(super) fn build_of(
    positions: &[f32],
    indices: &[u32],
) -> (Vec<DagCluster>, Vec<DagGroup>, Vec<GroupTally>) {
    let (dag, groups, tallies, _) = build_dag_tallied(
        positions,
        DagAttributes::default(),
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    (dag, groups, tallies)
}

pub(super) fn build(n: usize) -> (Vec<f32>, Vec<u32>, Vec<DagCluster>) {
    let (positions, indices) = grid(n);
    let (dag, _, _) = build_of(&positions, &indices);
    (positions, indices, dag)
}

/// A grid's positions and indices, its level-zero clusters, and the groups made of them.
pub(super) struct Grouped {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub clusters: Vec<Vec<u32>>,
    pub groups: Vec<Vec<usize>>,
}

/// The level-zero clusters of a grid and the groups the builder makes of them at every level.
pub(super) fn grouped(n: usize) -> Grouped {
    let (positions, indices) = grid(n);
    let clusters =
        cluster_triangles(&positions, &indices, DAG_CLUSTER_TRIANGLES).expect("clusters");
    let lists: Vec<&[u32]> = clusters.iter().map(|c| c.as_slice()).collect();
    let adjacency = cluster_adjacency(&lists);
    let centres: Vec<[f64; 3]> = clusters
        .iter()
        .map(|c| {
            let s = bounding_sphere(&positions, c);
            [s[0], s[1], s[2]]
        })
        .collect();
    let groups = group_clusters(&centres, &adjacency, DAG_GROUP_MAX);
    Grouped {
        positions,
        indices,
        clusters,
        groups,
    }
}

mod part1;
mod part10;
mod part11;
mod part2;
mod part3;
mod part4;
mod part5;
mod part6;
mod part7;
mod part8;
mod part9;
