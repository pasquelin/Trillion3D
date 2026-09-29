//! The root cover of one compiled primitive, kept where its DAG and its positions are both in
//! hand: further on, its clusters exist only as cache objects.
use crate::dag::{DagCluster, DagStrategy};
use crate::qem::compact_region;
use serde_json::Value;

/// One root cluster of a primitive: its triangles in the cover's own vertices, the error and the
/// sphere it was published at, in object units, and the streaming bundle of the primitive that
/// holds it.
#[derive(Clone, Debug)]
pub(crate) struct RootCluster {
    pub indices: Vec<u32>,
    pub error: f64,
    pub sphere: [f64; 4],
    pub bundle: usize,
}

/// The roots of a primitive, on the vertices they use, in object space. Empty for a primitive
/// with no DAG: it keeps pinning its own pages.
#[derive(Clone, Debug, Default)]
pub(crate) struct RootCover {
    pub positions: Vec<f32>,
    pub clusters: Vec<RootCluster>,
}

impl RootCover {
    /// The roots of `dag`, `pages` its published page records by culling rank, `page_of` the rank
    /// of each DAG slot. Exact clusters are all roots and never simplified: they carry none.
    pub(crate) fn of(
        strategy: DagStrategy,
        dag: &[DagCluster],
        pos: &[f32],
        pages: &[Value],
        page_of: &[usize],
    ) -> Self {
        if strategy == DagStrategy::ExactClusters {
            return Self::default();
        }
        let roots: Vec<(usize, &DagCluster)> = dag
            .iter()
            .enumerate()
            .filter(|(_, c)| c.is_root())
            .collect();
        let joined: Vec<u32> = roots
            .iter()
            .flat_map(|(_, c)| c.indices.iter().copied())
            .collect();
        let (positions, mut local, _) = compact_region(pos, &joined);
        let mut clusters = Vec::with_capacity(roots.len());
        for &(slot, cluster) in roots.iter().rev() {
            let at = local.len() - cluster.indices.len();
            let bundle = pages[page_of[slot]]["stream"].as_u64().unwrap_or(0) as usize;
            clusters.push(RootCluster {
                indices: local.split_off(at),
                error: cluster.lod_error,
                sphere: cluster.sphere,
                bundle,
            });
        }
        clusters.reverse();
        Self {
            positions,
            clusters,
        }
    }
}
