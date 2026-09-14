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
    let mut indices = Vec::with_capacity(n * n * 6);
    for y in 0..n as u32 {
        for x in 0..n as u32 {
            let a = y * w as u32 + x;
            indices.extend([
                a,
                a + 1,
                a + w as u32,
                a + 1,
                a + 1 + w as u32,
                a + w as u32,
            ]);
        }
    }
    (positions, indices)
}

pub(super) fn build(n: usize) -> (Vec<f32>, Vec<u32>, Vec<DagCluster>) {
    let (positions, indices) = grid(n);
    let (dag, _, _) = build_dag_tallied(&positions, &indices, &|| Ok(())).expect("dag");
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
mod part2;
mod part3;
mod part4;
