//! What the DAG builder guarantees on every case, asserted on the DAG it builds in memory.
use super::*;
use crate::dag::{build_dag_tallied, DagCluster, DagStrategy, GroupTally};
use std::collections::HashSet;

pub(super) struct Built {
    pub dag: Vec<DagCluster>,
    pub tallies: Vec<GroupTally>,
}
impl Built {
    pub fn roots(&self) -> usize {
        self.dag.iter().filter(|c| c.is_root()).count()
    }
}

/// The DAG of one primitive of the case, built as the compiler builds it: `qem-endpoints`, every
/// texture set the pages carry as the seam weld.
pub(super) fn build(case: &Case, indices: &[u32]) -> Built {
    let uv_sets: Vec<&[f32]> = case.uv_sets().into_iter().map(|(_, uvs)| uvs).collect();
    let (dag, _, tallies) = build_dag_tallied(
        &case.positions,
        &uv_sets,
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    Built { dag, tallies }
}

/// Level 0 partitions the source triangles; every coarse index names a vertex the source uses;
/// errors are finite and climb up the DAG.
pub(super) fn check_structure(case: &Case, indices: &[u32], built: &Built, label: &str) {
    let level0: Vec<&DagCluster> = built.dag.iter().filter(|c| c.level == 0).collect();
    assert_eq!(
        level0.iter().map(|c| c.triangles()).sum::<usize>(),
        indices.len() / 3,
        "{label}: level 0 covers the source"
    );
    let source = triangle_fingerprint(indices.as_chunks::<3>().0.iter().map(|t| t.as_slice()));
    let partition = triangle_fingerprint(
        level0
            .iter()
            .flat_map(|c| c.indices.as_chunks::<3>().0.iter().map(|t| t.as_slice())),
    );
    assert_eq!(
        source, partition,
        "{label}: level 0 is the source partition"
    );
    let used: HashSet<u32> = indices.iter().copied().collect();
    let vertices = case.vertex_count() as u32;
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
        match cluster.replacement {
            Some(parent) => {
                assert_eq!(
                    built.dag[parent].lod_error, cluster.parent_error,
                    "{label}: parent error"
                );
                assert_eq!(
                    built.dag[parent].level,
                    cluster.level + 1,
                    "{label}: parent level"
                );
            }
            None => assert!(cluster.is_root(), "{label}: unreplaced means root"),
        }
        if cluster.level > 0 {
            for &vertex in &cluster.indices {
                assert!(
                    vertex < vertices && used.contains(&vertex),
                    "{label}: a coarse vertex is a source vertex"
                );
            }
        }
    }
}

/// The roots the case expects, and never a silent stall: more than one root is always explained
/// by a tally.
pub(super) fn check_roots(expect: Roots, built: &Built, label: &str) {
    let roots = built.roots();
    let total = GroupTally::total(&built.tallies);
    let stalled = total.too_small + total.no_collapse + total.border_lost + total.unusable_error;
    assert!(
        roots == 1 || stalled > 0,
        "{label}: {roots} roots and no stall named"
    );
    match expect {
        Roots::One => {
            assert_eq!(roots, 1, "{label}: one root, tallies {:?}", built.tallies);
            assert_eq!(stalled, 0, "{label}: no stall");
        }
        Roots::Stalled(key) => {
            assert!(roots > 1, "{label}: the stall leaves several roots");
            assert!(
                total.json()[key].as_u64().unwrap_or(0) > 0,
                "{label}: the stall is named {key}, tallies {:?}",
                built.tallies
            );
        }
    }
}

/// Every cluster's page decodes back to its source positions and attributes, within the error
/// the page declares.
pub(super) fn check_pages(case: &Case, built: &Built, label: &str) {
    let attributes = case.attributes();
    let carried: Vec<&geometry_page::Attribute> = attributes.iter().collect();
    let exponent = crate::geometry_page_quant::primitive_exponent(
        &case.positions,
        built
            .dag
            .iter()
            .filter(|c| c.level > 0)
            .map(|c| c.lod_error),
    );
    for cluster in &built.dag {
        let encoded = geometry_page::encode(&cluster.indices, &case.positions, &carried, exponent)
            .unwrap_or_else(|e| panic!("{label}: encode level {}: {e}", cluster.level));
        let page = web_geometry_page_codec::decode(&encoded.bytes, 64 << 20)
            .unwrap_or_else(|e| panic!("{label}: decode level {}: {e:?}", cluster.level));
        crate::geometry_page::tests_codec::verify(
            &page,
            &cluster.indices,
            &case.positions,
            &attributes,
            page.quantization_error,
        );
    }
}
