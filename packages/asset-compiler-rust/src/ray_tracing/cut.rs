//! The coarse cut of a primitive's DAG: the clusters whose error lies at or under the error a ray
//! tracer keeps and whose group's lies over it. Each cluster's error is at least its children's
//! and under its group's, so exactly one cluster of every path from a finest cluster to a root
//! stands in the cut, and the surface it draws is whole.
use crate::dag::{clusters_area, DagCluster};
use crate::proxy::cut::selected;
use trillion3d_math::geometry::aabb::{aabb_of_f32, half_area};
use trillion3d_math::vector::vec3::point_f32;

/// The error a ray-traced cut keeps, in hundredths of the mesh's size.
pub(super) const FALLBACK_RELATIVE_ERROR: f32 = 1.0;

/// A triangle of the cut: its corners in the primitive's object space, the rank of its cluster
/// among the DAG's and its own rank in the cluster.
pub(super) struct CutTriangle {
    pub corners: [[f32; 3]; 3],
    pub cluster: u32,
    pub triangle: u32,
}

/// The triangles of the cut, and the error it keeps.
pub(super) struct Cut {
    pub error: f32,
    pub triangles: Vec<CutTriangle>,
}

/// The error the cut keeps: `FALLBACK_RELATIVE_ERROR` hundredths of the mesh's size, the square
/// root of the smaller of twice the area of its finest clusters and the surface of their box. The
/// finest clusters are those no group made: the level 0, and the leaves a trim left coarser.
pub(super) fn error_of(positions: &[f32], clusters: &[DagCluster]) -> f32 {
    let finest = || clusters.iter().filter(|cluster| cluster.source.is_none());
    let area = clusters_area(positions, finest());
    let corners = finest()
        .flat_map(|cluster| cluster.indices.iter())
        .map(|&v| point_f32(positions, v as usize));
    let (low, high) = aabb_of_f32(corners);
    let box_area = 2.0 * half_area(low, high);
    FALLBACK_RELATIVE_ERROR * 0.01 * (2.0 * area).min(box_area).sqrt()
}

/// The ranks of the clusters in the cut at `error`: those it does not exceed and their group's
/// exceeds, a root's being infinite.
pub(super) fn cut_clusters(
    clusters: &[DagCluster],
    error: f32,
) -> impl Iterator<Item = usize> + '_ {
    let error = f64::from(error);
    (clusters.iter().enumerate())
        .filter(move |(_, cluster)| selected(cluster, error))
        .map(|(rank, _)| rank)
}

/// The cut of the DAG `clusters`, whose indices lie in `positions`.
pub(super) fn cut_of(positions: &[f32], clusters: &[DagCluster]) -> Cut {
    let error = error_of(positions, clusters);
    let corners_of = |rank: usize| {
        let cluster = &clusters[rank];
        (cluster.indices.as_chunks::<3>().0.iter().enumerate()).map(move |(triangle, corners)| {
            CutTriangle {
                corners: corners.map(|v| point_f32(positions, v as usize)),
                cluster: rank as u32,
                triangle: triangle as u32,
            }
        })
    };
    Cut {
        error,
        triangles: cut_clusters(clusters, error).flat_map(corners_of).collect(),
    }
}
