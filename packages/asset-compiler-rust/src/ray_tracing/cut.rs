//! The coarse cut of a primitive's DAG: the clusters whose error lies at or under the error a ray
//! tracer keeps and whose group's lies over it. Each cluster's error is at least its children's
//! and under its group's, so exactly one cluster of every path from a finest cluster to a root
//! stands in the cut, and the surface it draws is whole.
use super::word::word;
use crate::dag::{clusters_area, DagCluster};
use crate::proxy::cut::selected;
use crate::Result;
use trillion3d_math::geometry::aabb::{aabb_of_f32, half_area};
use trillion3d_math::vector::vec3::point_f32;

/// The error a ray-traced cut keeps, in hundredths of the mesh's size.
pub(super) const FALLBACK_RELATIVE_ERROR: f32 = 1.0;

/// A triangle of the cut: its corners in the primitive's object space, the rank of its cluster
/// among the DAG's, its own rank in the cluster and its tag, which is zero but in the world's
/// directory.
pub(super) struct CutTriangle {
    pub corners: [[f32; 3]; 3],
    pub cluster: u32,
    pub triangle: u32,
    pub tag: u32,
}

/// The triangles of the cut, and the error it keeps.
pub(super) struct Cut {
    pub error: f32,
    pub triangles: Vec<CutTriangle>,
}

/// The finest clusters of a DAG: those no group made, the level 0 and the leaves a trim left
/// coarser.
pub(super) fn is_finest(cluster: &DagCluster) -> bool {
    cluster.source.is_none()
}

/// The error the cut keeps over the finest clusters `finest` of a mesh: `FALLBACK_RELATIVE_ERROR`
/// hundredths of the mesh's size, the square root of the smaller of twice their area and the
/// surface of their box.
pub(super) fn error_over<'a>(
    positions: &[f32],
    finest: impl Iterator<Item = &'a DagCluster> + Clone,
) -> f32 {
    let area = clusters_area(positions, finest.clone());
    let corners = finest
        .flat_map(|cluster| cluster.indices.iter())
        .map(|&v| point_f32(positions, v as usize));
    let (low, high) = aabb_of_f32(corners);
    let box_area = 2.0 * half_area(low, high);
    FALLBACK_RELATIVE_ERROR * 0.01 * (2.0 * area).min(box_area).sqrt()
}

/// The error the cut of the DAG `clusters` keeps (`error_over` its finest clusters).
pub(super) fn error_of(positions: &[f32], clusters: &[DagCluster]) -> f32 {
    error_over(positions, clusters.iter().filter(|c| is_finest(c)))
}

/// The clusters of `clusters`, each with its rank in its DAG, that stand in the cut at `error`:
/// those it does not exceed and their group's exceeds, a root's being infinite.
pub(super) fn cut_clusters<'a>(
    clusters: impl Iterator<Item = (usize, &'a DagCluster)>,
    error: f32,
) -> impl Iterator<Item = (usize, &'a DagCluster)> {
    let error = f64::from(error);
    clusters.filter(move |(_, cluster)| selected(cluster, error))
}

/// The triangles of cluster `cluster`, of rank `rank` in its DAG, whose indices lie in
/// `positions`; an error for a rank that does not fit the file's 32-bit words.
pub(super) fn triangles_of<'a>(
    positions: &'a [f32],
    (rank, cluster): (usize, &'a DagCluster),
) -> impl Iterator<Item = Result<CutTriangle>> + 'a {
    (cluster.indices.as_chunks::<3>().0.iter().enumerate()).map(move |(triangle, corners)| {
        Ok(CutTriangle {
            corners: corners.map(|v| point_f32(positions, v as usize)),
            cluster: word(rank, "cluster rank")?,
            triangle: word(triangle, "triangle rank")?,
            tag: 0,
        })
    })
}

/// The cut of the DAG `clusters`, whose indices lie in `positions`.
pub(super) fn cut_of(positions: &[f32], clusters: &[DagCluster]) -> Result<Cut> {
    let error = error_of(positions, clusters);
    let triangles = cut_clusters(clusters.iter().enumerate(), error)
        .flat_map(|cluster| triangles_of(positions, cluster))
        .collect::<Result<_>>()?;
    Ok(Cut { error, triangles })
}
