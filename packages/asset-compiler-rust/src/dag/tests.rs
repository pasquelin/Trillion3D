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

/// A grid rolled onto a cylinder of radius 8: a smooth curved surface.
pub(super) fn cylinder(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (mut positions, indices) = grid(n);
    for p in positions.as_chunks_mut::<3>().0 {
        let angle = p[0] / n as f32 * 3.0;
        (p[0], p[2]) = (8.0 * angle.cos(), 8.0 * angle.sin() + p[2] * 0.1);
    }
    (positions, indices)
}

/// Full mesh DAG, no UVs, no cancel point, and the positions its clusters index: the source's,
/// then every vertex a reduction placed.
pub(super) fn build_of(
    positions: &[f32],
    indices: &[u32],
) -> (Vec<DagCluster>, Vec<DagGroup>, Vec<GroupTally>, Vec<f32>) {
    let DagBuild {
        clusters: dag,
        groups,
        tallies,
        grown,
        ..
    } = build_dag(
        positions,
        DagAttributes::default(),
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    let drawn = grown.map_or_else(|| positions.to_vec(), |grown| grown.positions);
    (dag, groups, tallies, drawn)
}

/// A grid's DAG: the positions its clusters index, the source triangles and the clusters.
pub(super) fn build(n: usize) -> (Vec<f32>, Vec<u32>, Vec<DagCluster>) {
    let (positions, indices) = grid(n);
    let (dag, _, _, drawn) = build_of(&positions, &indices);
    (drawn, indices, dag)
}

/// A grid's positions and indices, its level-zero clusters with their external edges, and the
/// groups made of them.
pub(super) struct Grouped {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub clusters: Vec<Vec<u32>>,
    pub outer: Vec<Vec<u8>>,
    pub groups: Vec<Vec<usize>>,
}

/// The level-zero clusters of a grid and the groups the builder makes of them at every level.
pub(super) fn grouped(n: usize) -> Grouped {
    let (positions, indices) = grid(n);
    let Cut {
        clusters,
        mut outer,
    } = cluster_triangles(&positions, &indices, DAG_CLUSTER_TRIANGLES, &[]).expect("clusters");
    let lists: Vec<&[u32]> = clusters.iter().map(|c| c.as_slice()).collect();
    let weld = weld_positions(&positions, &indices);
    let adjacency = cluster_adjacency(&lists, &mut outer, &weld);
    let sources = vec![None; clusters.len()];
    let boxes: Vec<_> = lists
        .iter()
        .map(|list| cluster_box(&positions, list))
        .collect();
    let bounds = trillion3d_page_codec::clusters::vertex_bounds(&positions);
    let groups = group_clusters(&boxes, bounds, &sources, &adjacency);
    Grouped {
        positions,
        indices,
        clusters,
        outer,
        groups,
    }
}

mod boundary;
mod culling;
mod grown;
mod hausdorff;
mod levels;
mod ownership;
mod soup;
mod spheres;
mod stalls;
mod welds;
mod window_panes;
