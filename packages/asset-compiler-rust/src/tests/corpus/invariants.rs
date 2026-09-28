//! What the DAG builder guarantees on every case, asserted on the DAG it builds in memory.
use super::*;
use crate::dag::{build_dag_tallied, DagCluster, DagGroup, DagStall, DagStrategy, Grown};
use std::collections::HashSet;

pub(super) struct Built {
    pub dag: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub stalls: Vec<DagStall>,
    /// The case's vertices grown with those a seam-locked group's solve placed.
    pub grown: Option<Grown>,
}
impl Built {
    pub fn roots(&self) -> usize {
        self.dag.iter().filter(|c| c.is_root()).count()
    }
    /// Per cluster, whether it descends from a group reduced with solved vertices: one whose
    /// outputs draw a vertex placed after the case's `source` vertices.
    pub fn solved(&self, source: usize) -> Vec<bool> {
        let placed = |&c: &usize| self.dag[c].indices.iter().any(|&v| v as usize >= source);
        let mut solved = vec![false; self.dag.len()];
        // The builder pushes a group's children before its outputs.
        for (id, cluster) in self.dag.iter().enumerate() {
            solved[id] = cluster.source.is_some_and(|g| {
                let group = &self.groups[g];
                group.outputs.iter().any(placed) || group.children.iter().any(|&c| solved[c])
            });
        }
        solved
    }
    /// The positions the pages read: the case's, then every placed vertex.
    pub fn positions<'a>(&'a self, case: &'a Case) -> &'a [f32] {
        self.grown
            .as_ref()
            .map_or(&case.positions, |g| &g.positions)
    }
    /// The attributes the pages carry, grown likewise.
    pub fn attributes(&self, case: &Case) -> Vec<geometry_page::Attribute> {
        self.grown
            .as_ref()
            .map_or_else(|| case.attributes(), |g| g.carried.clone())
    }
}

/// The DAG of one primitive of the case, built as the compiler builds it: `qem-endpoints`, the
/// normals and every texture set the pages carry.
pub(super) fn build(case: &Case, indices: &[u32]) -> Built {
    let attributes = case.attributes();
    let carried: Vec<&geometry_page::Attribute> = attributes.iter().collect();
    let (dag, groups, _, stalls, grown) = build_dag_tallied(
        &case.positions,
        crate::dag::DagAttributes { carried: &carried },
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    Built {
        dag,
        groups,
        stalls,
        grown,
    }
}

/// Level 0 partitions the source triangles; every coarse index names a vertex the source uses or
/// one a solve placed; errors are finite and climb up the DAG; the cook's own check passes
/// (`dag::quality`).
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
    let attributes = built.attributes(case);
    let normals = attributes
        .iter()
        .find(|a| a.flag == geometry_page::FLAG_NORMAL);
    let normals = normals.map(|a| &a.values[..]);
    let quality = crate::dag::quality::check(&built.dag, built.positions(case), normals);
    if let Err(refusal) = quality {
        panic!("{label}: the cook refuses the DAG: {refusal}");
    }
    let used: HashSet<u32> = indices.iter().copied().collect();
    let vertices = case.vertex_count() as u32;
    let grown = (built.positions(case).len() / 3) as u32;
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
                let placed = (vertices..grown).contains(&vertex);
                assert!(
                    placed || used.contains(&vertex),
                    "{label}: a coarse vertex is a source vertex or a placed one"
                );
            }
        }
    }
}

/// One root per primitive, and no stalled group: every layout of the corpus, seam-locked ones
/// included (`dag/solved.rs`), climbs to the top.
pub(super) fn check_roots(built: &Built, label: &str) {
    let causes: Vec<(usize, &str)> = built
        .stalls
        .iter()
        .map(|s| (s.level, s.outcome.cause.name()))
        .collect();
    assert_eq!(built.roots(), 1, "{label}: one root, stalls {causes:?}");
    assert!(causes.is_empty(), "{label}: no stall, stalls {causes:?}");
}

/// Every cluster's page decodes back to its source positions and attributes, within the error
/// the page declares.
pub(super) fn check_pages(case: &Case, built: &Built, label: &str) {
    let attributes = built.attributes(case);
    let carried: Vec<&geometry_page::Attribute> = attributes.iter().collect();
    let positions = built.positions(case);
    let exponent = crate::geometry_page_quant::primitive_exponent(
        positions,
        built
            .dag
            .iter()
            .filter(|c| c.level > 0)
            .map(|c| c.lod_error),
        false,
        crate::geometry_page_quant::tile::TILE_EXTENT_LOG2,
    );
    for cluster in &built.dag {
        let encoded = geometry_page::encode(
            &cluster.indices,
            positions,
            &carried,
            exponent,
            crate::geometry_page_quant::UV_EXPONENT,
        )
        .unwrap_or_else(|e| panic!("{label}: encode level {}: {e}", cluster.level));
        let page = trillion3d_page_codec::decode(&encoded.bytes, 64 << 20)
            .unwrap_or_else(|e| panic!("{label}: decode level {}: {e:?}", cluster.level));
        crate::geometry_page::tests_codec::verify(
            &page,
            &cluster.indices,
            positions,
            &attributes,
            page.quantization_error,
        );
    }
}
