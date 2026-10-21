//! What the DAG builder guarantees on every case, asserted on the DAG it builds in memory.
pub(super) use super::invariants_pages::check_pages;
use super::*;
use crate::compiler::primitive::checks::triangle_fingerprint;
use crate::dag::{build_dag, DagBuild, DagCluster, DagStall, DagStrategy};
use std::collections::{HashMap, HashSet};

pub(super) struct Built {
    pub dag: Vec<DagCluster>,
    pub stalls: Vec<DagStall>,
    /// The arrays the pages read: the case's, then every vertex a solve placed (`dag::Grown`).
    pub positions: Vec<f32>,
    pub attributes: Vec<encode::Attribute>,
    /// The case's triangles as the build read them (`DagBuild::indices`): what level 0 partitions.
    pub indices: Vec<u32>,
}
impl Built {
    pub fn roots(&self) -> usize {
        self.dag.iter().filter(|c| c.is_root()).count()
    }
}

/// The DAG of one primitive of the case, built as the compiler builds it: `qem-endpoints`, the
/// normals and every texture set the pages carry.
pub(super) fn build(case: &Case, indices: &[u32]) -> Built {
    let mut attributes = case.attributes();
    // A case without `NORMAL` carries normals all nothing when the compiler's mesh build rebuilds
    // every normal (its default, `page_attributes`), and the build then lays them: the DAG built
    // here is the one the compiler builds, a flat-shaded corner included.
    if case.normals.is_none() && crate::DEFAULT_RECOMPUTE_NORMALS {
        attributes.insert(
            0,
            encode::Attribute {
                flag: trillion3d_page_codec::FLAG_NORMAL,
                width: 3,
                values: vec![0.0; case.vertex_count() * 3],
            },
        );
    }
    let carried: Vec<&encode::Attribute> = attributes.iter().collect();
    let DagBuild {
        clusters: dag,
        stalls,
        grown,
        indices: read,
        ..
    } = build_dag(
        &case.positions,
        crate::dag::DagAttributes { carried: &carried },
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    let (positions, attributes) = match grown {
        Some(grown) => (grown.positions, grown.carried),
        None => (case.positions.clone(), attributes),
    };
    Built {
        dag,
        stalls,
        positions,
        attributes,
        indices: read,
    }
}

/// Level 0 partitions the source triangles as the build read them; every coarse index names a
/// vertex the source uses or a solve placed; errors are finite and climb up the DAG; the cook's
/// check passes (`dag::quality`).
pub(super) fn check_structure(case: &Case, indices: &[u32], built: &Built, label: &str) {
    let level0: Vec<&DagCluster> = built.dag.iter().filter(|c| c.level == 0).collect();
    let read = &built.indices;
    assert_eq!(
        level0.iter().map(|c| c.triangles()).sum::<usize>(),
        read.len() / 3,
        "{label}: level 0 covers the source"
    );
    let source = triangle_fingerprint(read.as_chunks::<3>().0.iter().map(|t| t.as_slice()));
    let partition = triangle_fingerprint(
        level0
            .iter()
            .flat_map(|c| c.indices.as_chunks::<3>().0.iter().map(|t| t.as_slice())),
    );
    assert_eq!(
        source, partition,
        "{label}: level 0 is the source partition"
    );
    if let Err(refusal) = crate::dag::quality::check(&built.dag) {
        panic!("{label}: the cook refuses the DAG: {refusal}");
    }
    let used: HashSet<u32> = indices.iter().copied().collect();
    let vertices = case.vertex_count() as u32;
    let grown = (built.positions.len() / 3) as u32;
    // Each group's outputs, by the `source` link the runtime reads beside `group`.
    let mut outputs: HashMap<usize, Vec<&DagCluster>> = HashMap::new();
    for cluster in &built.dag {
        if let Some(group) = cluster.source {
            outputs.entry(group).or_default().push(cluster);
        }
    }
    for cluster in &built.dag {
        assert!(
            cluster.lod_error.is_finite() && cluster.lod_error >= 0.0,
            "{label}: a finite error at level {}",
            cluster.level
        );
        assert!(
            cluster.lod_error <= cluster.parent_error,
            "{label}: errors climb"
        );
        match cluster.group {
            Some(group) => {
                let parents = outputs.get(&group).map_or(&[][..], Vec::as_slice);
                assert!(!parents.is_empty(), "{label}: a group has outputs");
                for parent in parents {
                    assert_eq!(
                        parent.lod_error, cluster.parent_error,
                        "{label}: parent error"
                    );
                    assert_eq!(parent.level, cluster.level + 1, "{label}: parent level");
                }
            }
            None => assert!(cluster.is_root(), "{label}: unreplaced means root"),
        }
        if cluster.level > 0 {
            for &vertex in &cluster.indices {
                let placed = (vertices..grown).contains(&vertex);
                assert!(
                    placed || used.contains(&vertex),
                    "{label}: a coarse vertex is a source vertex or a placed one"
                );
            }
        }
    }
}

/// One root cluster per primitive, and no stalled group: every layout of the corpus, every seam
/// included (`simplify/region/collapse.rs`, its wedges), climbs to the top. A root over the encoder's vertex
/// cap is halved once every level is built (`dag::constrain_wide`): its two halves share its group,
/// level and error, and draw together at most one cluster's triangles.
pub(super) fn check_roots(built: &Built, label: &str) {
    let causes: Vec<(usize, &str)> = built
        .stalls
        .iter()
        .map(|s| (s.level, s.outcome.cause.name()))
        .collect();
    let roots: Vec<&DagCluster> = built.dag.iter().filter(|c| c.is_root()).collect();
    let one = match roots[..] {
        [_] => true,
        [a, b] => {
            (a.source, a.level, a.lod_error) == (b.source, b.level, b.lod_error)
                && a.indices.len() + b.indices.len() <= 3 * crate::dag::DAG_CLUSTER_TRIANGLES
        }
        _ => false,
    };
    assert!(
        one,
        "{label}: one root, {} roots, stalls {causes:?}",
        roots.len()
    );
    assert!(causes.is_empty(), "{label}: no stall, stalls {causes:?}");
}
