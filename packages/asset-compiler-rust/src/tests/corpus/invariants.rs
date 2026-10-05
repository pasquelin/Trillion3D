//! What the DAG builder guarantees on every case, asserted on the DAG it builds in memory.
use super::*;
use crate::dag::{build_dag_tallied, DagCluster, DagStall, DagStrategy};
use std::collections::{HashMap, HashSet};

pub(super) struct Built {
    pub dag: Vec<DagCluster>,
    pub stalls: Vec<DagStall>,
    /// The arrays the pages read: the case's, then every vertex a solve placed (`dag::Grown`).
    pub positions: Vec<f32>,
    pub attributes: Vec<geometry_page::Attribute>,
    /// Per placed vertex, the case's vertex it was solved from.
    pub origin: Vec<u32>,
}
impl Built {
    pub fn roots(&self) -> usize {
        self.dag.iter().filter(|c| c.is_root()).count()
    }
}

/// The DAG of one primitive of the case, built as the compiler builds it: `qem-endpoints`, the
/// normals and every texture set the pages carry.
pub(super) fn build(case: &Case, indices: &[u32]) -> Built {
    let attributes = case.attributes();
    let carried: Vec<&geometry_page::Attribute> = attributes.iter().collect();
    let (dag, _, _, stalls, grown) = build_dag_tallied(
        &case.positions,
        crate::dag::DagAttributes { carried: &carried },
        indices,
        DagStrategy::QemEndpoints,
        &|| Ok(()),
    )
    .expect("dag");
    let (positions, attributes, origin) = match grown {
        Some(grown) => (grown.positions, grown.carried, grown.origin),
        None => (case.positions.clone(), attributes, Vec::new()),
    };
    Built {
        dag,
        stalls,
        positions,
        attributes,
        origin,
    }
}

/// Level 0 partitions the source triangles; every coarse index names a vertex the source uses or
/// a solve placed; errors are finite and climb up the DAG; the cook's check passes (`dag::quality`).
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
    let carried: Vec<&geometry_page::Attribute> = built.attributes.iter().collect();
    let normals = crate::dag::DagAttributes { carried: &carried }.normals();
    let quality = crate::dag::quality::check(&built.dag, &built.positions, normals);
    if let Err(refusal) = quality {
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
        // The projection spheres (#929): each holds its cluster and sits in the replacing group's,
        // within the builder merge's own rounding.
        use crate::shared_math::{length, point, sub};
        let beyond = |s: [f64; 4], c| length(sub(c, [s[0], s[1], s[2]])) - s[3] * (1.0 + 1e-12);
        let [x, y, z, r] = cluster.sphere;
        let outside = (cluster.indices.iter())
            .map(|&v| beyond(cluster.sphere, point(&built.positions, v)))
            .fold(beyond(cluster.parent_sphere, [x, y, z]) + r, f64::max);
        assert!(outside <= 0.0, "{label}: a sphere leaves its bound");
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
pub(super) fn check_pages(built: &Built, label: &str) {
    let (positions, attributes) = (&built.positions, &built.attributes);
    let carried: Vec<&geometry_page::Attribute> = attributes.iter().collect();
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
            attributes,
            page.quantization_error,
        );
    }
}
