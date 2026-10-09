//! The root cover of one compiled primitive, kept where its DAG, its positions and the attributes
//! its pages carry are all in hand: further on, its clusters exist only as cache objects.
use crate::dag::{DagCluster, DagStrategy};
use crate::geometry_page::Attribute;
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

/// The roots of a primitive, on the vertices they use, in object space, with every attribute its
/// pages carry on those vertices — normals, texture sets, colour —, which the world super-roots
/// carry on (`merge.rs`). Empty for a primitive with no DAG: it keeps pinning its own pages.
#[derive(Clone, Debug, Default)]
pub(crate) struct RootCover {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub clusters: Vec<RootCluster>,
}

impl RootCover {
    /// The roots of `dag` on `pos` and the attributes its pages carry (`carried`, one value set per
    /// vertex of `pos`), `pages` its published page records by culling rank, `page_of` the rank of
    /// each DAG slot. Exact clusters are all roots and never simplified: they carry none.
    pub(crate) fn of(
        strategy: DagStrategy,
        dag: &[DagCluster],
        (pos, carried): (&[f32], &[&Attribute]),
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
        let (positions, mut local, remap) = compact_region(pos, &joined);
        let carried = carried
            .iter()
            .map(|attribute| compact_attribute(attribute, &remap))
            .collect();
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
            carried,
            clusters,
        }
    }
}

/// `attribute` on the vertices `remap` keeps, in its order (`qem::push_vertex`, which refuses a
/// vertex the attribute lacks).
pub(super) fn compact_attribute(attribute: &Attribute, remap: &[u32]) -> Attribute {
    let width = attribute.width;
    let mut values = Vec::with_capacity(remap.len() * width);
    for &source in remap {
        crate::qem::push_vertex(&mut values, &attribute.values, width, source);
    }
    Attribute {
        flag: attribute.flag,
        width,
        values,
    }
}
