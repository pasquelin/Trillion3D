//! The grid every page of a primitive is quantized on: its positions in centimetres on cells of
//! one precision, its normals and tangents at their precisions (`PageGrid`, in the shared codec
//! `trillion3d_page_codec::bits::grid`, which the run-time cut asks too). The precision follows the
//! size of the primitive's finest clusters, as a mesh build sets it, unless the mesh names one; the
//! clusters are those the build made, measured before a trim cuts any away (`dag::cut_finest`).
use crate::dag::DagCluster;
use crate::{CompilerError, Result};
use trillion3d_page_codec::bits::grid::{Extent, PageGrid, Precision};

/// The boxes of `clusters` over `positions`, each as the page that draws it is bounded
/// (`DagCluster::drawn_box`: the whole cluster's for a half of one), a cluster of the finest level
/// the one whose size sets the precision.
pub(crate) fn page_extents<'a>(
    positions: &[f32],
    clusters: impl IntoIterator<Item = &'a DagCluster>,
) -> Vec<Extent> {
    (clusters.into_iter())
        .map(|cluster| {
            let (low, high) = cluster.drawn_box(positions);
            Extent {
                low: low.map(|v| v as f32),
                high: high.map(|v| v as f32),
                finest: cluster.level == 0,
            }
        })
        .collect()
}

/// The grid of the pages that draw `extents`, the precisions `precision` names or the format's:
/// refused when a cluster is too wide for the coarsest precision.
pub(crate) fn page_grid(precision: Precision, extents: &[Extent]) -> Result<PageGrid> {
    PageGrid::of(precision, extents).ok_or_else(|| {
        CompilerError::new(
            "PAGE_ATTRIBUTE_RANGE",
            "A cluster is wider than the coarsest position grid holds",
        )
    })
}
