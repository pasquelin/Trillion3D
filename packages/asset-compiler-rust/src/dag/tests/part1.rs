use super::*;
use std::collections::HashMap;

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
    let (_, _, clusters, groups) = grouped(160);
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
        // The parent bounds must enclose the cluster's own bounds, so the projected error is monotone too.
        if cluster.parent_error.is_finite() {
            let d = ((cluster.sphere[0] - cluster.parent_sphere[0]).powi(2)
                + (cluster.sphere[1] - cluster.parent_sphere[1]).powi(2)
                + (cluster.sphere[2] - cluster.parent_sphere[2]).powi(2))
            .sqrt();
            assert!(
                d + cluster.sphere[3] <= cluster.parent_sphere[3] + 1e-6,
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
        if error.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
            return 0.0;
        }
        if !error.is_finite() {
            return f64::INFINITY;
        }
        let distance =
            (sphere[0] * sphere[0] + sphere[1] * sphere[1] + (sphere[2] - 4000.0).powi(2)).sqrt()
                - sphere[3];
        if distance <= 1.0 {
            return f64::INFINITY;
        }
        error * 600.0 / distance
    };
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
                let Some(next) = dag[node].replacement else {
                    break;
                };
                node = next;
                hops += 1;
                assert!(hops <= DAG_MAX_LEVELS, "chain must terminate");
            }
            assert!(dag[node].is_root(), "a chain must end on a root");
            assert_eq!(
                selected, 1,
                "threshold {threshold}: chain from cluster {id} selected {selected} clusters"
            );
        }
    }
}
