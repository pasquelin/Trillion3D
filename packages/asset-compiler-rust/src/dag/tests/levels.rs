use super::*;
use std::collections::HashMap;
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vecn::{length, sub};

#[test]
fn level_zero_clusters_respect_the_triangle_budget_and_cover_the_source_once() {
    let (_, indices, dag) = build(160); // 51 200 triangles
    let leaves: Vec<&DagCluster> = dag.iter().filter(|c| c.level == 0).collect();
    assert!(leaves.len() > 1);
    for cluster in &leaves {
        assert!(
            cluster.triangles() <= DAG_CLUSTER_TRIANGLES,
            "cluster of {} triangles",
            cluster.triangles()
        );
        assert!(cluster.triangles() > 0);
    }
    let key = |tri: &[u32]| {
        let mut t = [tri[0], tri[1], tri[2]];
        t.sort_unstable();
        t
    };
    let mut from_source: HashMap<[u32; 3], usize> = HashMap::new();
    for tri in indices.as_chunks::<3>().0 {
        *from_source.entry(key(tri)).or_insert(0) += 1;
    }
    let mut from_dag: HashMap<[u32; 3], usize> = HashMap::new();
    for cluster in &leaves {
        for tri in cluster.indices.as_chunks::<3>().0 {
            *from_dag.entry(key(tri)).or_insert(0) += 1;
        }
    }
    assert_eq!(
        from_dag, from_source,
        "level 0 must cover every source triangle exactly once"
    );
}

#[test]
fn every_level_above_zero_uses_groups_of_eight_to_thirty_two_clusters() {
    // Grouping is exercised directly: the builder feeds it the live cluster graph each level.
    let Grouped {
        clusters, groups, ..
    } = grouped(160);
    assert!(groups.len() > 1);
    let mut seen = vec![false; clusters.len()];
    for group in &groups {
        assert!(group.len() <= DAG_GROUP_MAX, "group of {}", group.len());
        assert!(
            group.len() >= DAG_GROUP_MIN || groups.len() == 1,
            "group of {}",
            group.len()
        );
        for &member in group {
            assert!(!seen[member], "cluster in two groups");
            seen[member] = true;
        }
    }
    assert!(
        seen.into_iter().all(|v| v),
        "every cluster belongs to a group"
    );
}

#[test]
fn errors_are_monotone_and_roots_are_terminal() {
    let (_, _, dag) = build(160);
    let mut roots = 0;
    for cluster in &dag {
        assert!(cluster.lod_error >= 0.0 && cluster.lod_error.is_finite());
        assert!(
            cluster.parent_error >= cluster.lod_error,
            "parent {} < lod {}",
            cluster.parent_error,
            cluster.lod_error
        );
        if cluster.level == 0 {
            assert_eq!(cluster.lod_error, 0.0);
        }
        if cluster.is_root() {
            roots += 1;
        }
        // The parent bounds enclose the cluster's own bounds, so the projected error is monotone
        // too, within the reach the ball of balls holds two balls nested at (`bounds::balls_ball`:
        // 1e-4 on the squared distance of their centres, a hundredth at most).
        if cluster.parent_error.is_finite() {
            let [s, p] = [cluster.sphere, cluster.parent_sphere];
            let d = length(sub([s[0], s[1], s[2]], [p[0], p[1], p[2]]));
            assert!(
                d + s[3] <= p[3] + 1e-2,
                "parent sphere must enclose the child sphere"
            );
        }
    }
    assert!(roots >= 1);
    assert!(
        dag.iter().any(|c| c.level > 0),
        "the DAG must have at least one coarse level"
    );
}

#[test]
fn every_threshold_selects_exactly_one_cluster_per_ancestor_chain() {
    let (_, _, dag) = build(160);
    // Projected error at a fixed eye: monotone in the stored object error and in the sphere radius.
    let project = |error: f64, sphere: [f64; 4]| -> f64 {
        if not_above(error, 0.0) {
            return 0.0;
        }
        if !error.is_finite() {
            return f64::INFINITY;
        }
        let distance = length([sphere[0], sphere[1], sphere[2] - 4000.0]) - sphere[3];
        if distance <= 1.0 {
            return f64::INFINITY;
        }
        error * 600.0 / distance
    };
    // A cluster's replacing group, then that group's first output: the links the runtime reads.
    let mut first_output: HashMap<usize, usize> = HashMap::new();
    for (id, cluster) in dag.iter().enumerate() {
        if let Some(group) = cluster.source {
            first_output.entry(group).or_insert(id);
        }
    }
    for &threshold in &[0.0_f64, 0.25, 1.0, 4.0, 64.0, 1e9] {
        let drawn = |c: &DagCluster| {
            project(c.lod_error, c.sphere) <= threshold
                && project(c.parent_error, c.parent_sphere) > threshold
        };
        for (id, leaf) in dag.iter().enumerate() {
            if leaf.level != 0 {
                continue;
            }
            let mut node = id;
            let mut hops = 0;
            let mut selected = 0;
            loop {
                if drawn(&dag[node]) {
                    selected += 1;
                }
                let Some(group) = dag[node].group else {
                    break;
                };
                node = first_output[&group];
                hops += 1;
                assert!(hops <= dag.len(), "chain must terminate");
            }
            assert!(dag[node].is_root(), "a chain must end on a root");
            assert_eq!(
                selected, 1,
                "threshold {threshold}: chain from cluster {id} selected {selected} clusters"
            );
        }
    }
}

/// A grid and a copy of it a hundred units along x, laid end to end: the arrays of an assembly
/// primitive whose blocks are the grid, then its copy.
fn two_grids(n: usize) -> (Vec<f32>, Vec<u32>, [crate::dag::assembly::Block; 2]) {
    let (mut positions, mut indices) = grid(n);
    let (vertices, corners) = (positions.len() / 3, indices.len());
    let copy: Vec<f32> = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|p| [p[0] + 100.0, p[1], p[2]])
        .collect();
    positions.extend(copy);
    let carried: Vec<u32> = indices[..corners]
        .iter()
        .map(|v| v + vertices as u32)
        .collect();
    indices.extend(carried);
    let block = |at: usize| crate::dag::assembly::Block {
        vertices: (at * vertices, vertices),
        indices: (at * corners, corners),
    };
    (positions, indices, [block(0), block(1)])
}

// Behaviour: the blocks of an assembly are built apart and joined under levels built over their
// roots: level 0 covers every triangle once, errors stay monotone, the roots of the blocks are
// replaced by a level above them, and every cluster's vertices lie in the arrays handed on.
#[test]
fn an_assembly_joins_its_blocks_under_levels_built_over_their_roots() {
    let (positions, indices, blocks) = two_grids(48);
    let assembly = AssemblyBlocks {
        base: false,
        blocks: blocks.to_vec(),
    };
    let settings = DagSettings::from(DagStrategy::QemEndpoints);
    let attributes = DagAttributes::default();
    let built = build_assembly(
        &positions,
        attributes,
        &indices,
        &assembly,
        settings,
        &|| Ok(()),
    )
    .expect("assembly");
    let level0: usize = (built.clusters.iter())
        .filter(|c| c.level == 0)
        .map(|c| c.triangles())
        .sum();
    assert_eq!(level0, indices.len() / 3);
    crate::dag::quality::check(&built.clusters).expect("errors never drop to a parent");
    let (half_positions, half_indices) = (
        &positions[..positions.len() / 2],
        &indices[..indices.len() / 2],
    );
    let (alone, _, _, _) = build_of(half_positions, half_indices);
    let one_grid_top = alone.iter().map(|c| c.level).max().expect("levels");
    let top = built
        .clusters
        .iter()
        .map(|c| c.level)
        .max()
        .expect("clusters");
    assert!(top > one_grid_top, "a level joins the two blocks");
    let drawn = built
        .grown
        .as_ref()
        .expect("the arrays the pages read")
        .positions
        .len()
        / 3;
    assert!(built
        .clusters
        .iter()
        .all(|c| c.indices.iter().all(|&v| (v as usize) < drawn)));
    assert!(built.clusters.iter().filter(|c| c.is_root()).count() <= 2);
}

// Behaviour: a build that makes no coarse level makes none over the blocks either.
#[test]
fn an_assembly_of_exact_clusters_climbs_no_level() {
    let (positions, indices, blocks) = two_grids(16);
    let assembly = AssemblyBlocks {
        base: true,
        blocks: blocks.to_vec(),
    };
    let settings = DagSettings::from(DagStrategy::ExactClusters);
    let attributes = DagAttributes::default();
    let built = build_assembly(
        &positions,
        attributes,
        &indices,
        &assembly,
        settings,
        &|| Ok(()),
    )
    .expect("assembly");
    assert!(built.groups.is_empty());
    assert!(built.clusters.iter().all(|c| c.level == 0 && c.is_root()));
    let triangles: usize = built.clusters.iter().map(|c| c.triangles()).sum();
    assert_eq!(triangles, indices.len() / 3);
}

// Behaviour: the blocks a primitive names must lie in order, whole triangles, within its arrays.
#[test]
fn the_blocks_a_primitive_names_lie_in_order_and_within_its_arrays() {
    use serde_json::json;
    let named = |blocks: serde_json::Value| json!({"extras": {"assembly": {"base": true, "blocks": blocks}}});
    let read = |blocks| AssemblyBlocks::of(&named(blocks), 6, 6);
    let both = read(json!([[0, 3, 0, 3], [3, 3, 3, 3]]))
        .expect("reads")
        .expect("named");
    assert!(both.base);
    assert_eq!(both.blocks.len(), 2);
    assert!(AssemblyBlocks::of(&json!({"attributes": {}}), 6, 6)
        .expect("reads")
        .is_none());
    for refused in [
        json!([[0, 3, 0, 3], [2, 3, 3, 3]]),
        json!([[0, 3, 0, 2]]),
        json!([[0, 7, 0, 3]]),
        json!([[0, 3, 0, 9]]),
    ] {
        assert!(read(refused).is_err());
    }
}
