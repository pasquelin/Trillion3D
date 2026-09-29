//! The root cover of one compiled primitive, kept where its DAG and its positions are both in
//! hand: further on, its clusters exist only as cache objects.
use crate::dag::{DagCluster, DagStrategy};
use serde_json::Value;
use std::collections::HashMap;

/// One root cluster of a primitive: its triangles in the cover's own vertices, the error it was
/// published at, in object units, and the streaming bundle of the primitive that holds it.
#[derive(Clone, Debug)]
pub(crate) struct RootCluster {
    pub indices: Vec<u32>,
    pub error: f64,
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
        let mut cover = Self::default();
        if strategy == DagStrategy::ExactClusters {
            return cover;
        }
        let mut local: HashMap<u32, u32> = HashMap::new();
        for (slot, cluster) in dag.iter().enumerate().filter(|(_, c)| c.is_root()) {
            let mut indices = Vec::with_capacity(cluster.indices.len());
            for &vertex in &cluster.indices {
                let next = local.len() as u32;
                let id = *local.entry(vertex).or_insert_with(|| {
                    let at = vertex as usize * 3;
                    cover.positions.extend_from_slice(&pos[at..at + 3]);
                    next
                });
                indices.push(id);
            }
            let page = &pages[page_of[slot]];
            let bundle = page["stream"].as_u64().unwrap_or(0) as usize;
            cover.clusters.push(RootCluster {
                indices,
                error: cluster.lod_error,
                bundle,
            });
        }
        cover
    }
}
