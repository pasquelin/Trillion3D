//! A primitive's pages: each cluster's geometry page encoded, its record, and the pages packed in
//! streaming bundles — the unit a runtime reads, keeps and drops (`compiler_page_bundles.rs`) —,
//! their bytes end to end in the primitive's run, a scratch file the geometry containers take once
//! every primitive is compiled (`compiler_geometry_files.rs`), then remove. No page is a file of its
//! own, and no run is an object.
use super::*;
use crate::compiler_page_bundles::{lay_bundles, Bundle};
use crate::coplanar::plane::plane_of_triangles;
use crate::coplanar::ClusterPlane;
use crate::dag::{DagCluster, DagGroup};
use std::sync::atomic::{AtomicUsize, Ordering};
use trillion3d_page_codec::culling::CullingCluster;
use trillion3d_page_codec::normal_cone::face_crosses;

/// The run of a primitive's pages: their bundles end to end in the scratch file at `path` until the
/// containers take them, and its bundles in run order.
#[derive(Clone, Debug)]
pub(crate) struct PageRun {
    pub path: PathBuf,
    pub bundles: Vec<Bundle>,
    /// The bundles the root cover fills, first in the run.
    pub pinned: usize,
    /// The most bundles a bundle needs directly, fixed before packing, and the longest closed list.
    pub dependency_bound: usize,
    pub max_dependencies: usize,
}

/// A run's scratch file, unique within the process and among the processes sharing the cache.
fn run_path(o: &Options) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let rank = NEXT.fetch_add(1, Ordering::Relaxed);
    crate::compiler_storage::runs_dir(&o.cache).join(format!("{}-{rank}.bin", std::process::id()))
}

/// Pages, by culling rank: their records, the plane each cluster lies in, when it lies in one
/// (`coplanar::plane`), and their run.
pub(super) type DagPages = (Vec<Value>, Vec<Option<ClusterPlane>>, Option<PageRun>);

/// The records of the pages of `dag` in culling `order`, each cluster's geometry page encoded by
/// `encode`, packed in bundles laid end to end in the primitive's run (`PageRun`), banded at
/// `scale`, the largest world scale its mesh is placed at (`lay_bundles`). A page names its bundle
/// (`stream`) and its place there (`streamOffset`) and carries the cone `encode` measured. Each
/// cluster's plane is tested here, on the face crosses and the box its record measures.
pub(super) fn dag_pages(
    o: &Options,
    (dag, groups, boxes): (&[DagCluster], &[DagGroup], &[CullingCluster]),
    (order, scale): (&[usize], f64),
    pos: &[f32],
    encode: &(impl Fn(&[u32]) -> Result<compiler_page_record::EncodedPage> + Sync),
) -> Result<DagPages> {
    let flatness = crate::coplanar::CoplanarBounds::default().flatness_ratio;
    let encoded: Vec<(Value, Option<ClusterPlane>, Vec<u8>)> = order
        .par_iter()
        .enumerate()
        .map(
            |(rank, &slot)| -> Result<(Value, Option<ClusterPlane>, Vec<u8>)> {
                check(o)?;
                // Every index names a vertex of `pos`: the source's were checked once, where they are
                // read (`triangles::read`), and the DAG names no other than those and what it placed.
                let cluster = &dag[slot];
                let (geometry, bytes, cone) = {
                    let _t = perf::Timer::new(perf::Phase::PagePacked);
                    encode(&cluster.indices)?
                };
                // The box is the hierarchy's (`dag::bounds::culling_clusters`), measured once.
                let CullingCluster { min, max, .. } = boxes[slot];
                // The cone is the encoder's, of the faces the page draws (`encode::decoded_cone`);
                // the plane is the source's, which the coplanar merge reads.
                let crosses = face_crosses(pos, &cluster.indices);
                let plane =
                    plane_of_triangles((&cluster.indices, pos), &crosses, (min, max), flatness);
                let record =
                    compiler_page_record::page_record((rank, cluster), (min, max), cone, geometry);
                Ok((record, plane, bytes))
            },
        )
        .collect::<Result<_>>()?;
    if encoded.is_empty() {
        return Ok((Vec::new(), Vec::new(), None));
    }
    let mut pages = Vec::with_capacity(encoded.len());
    let mut planes = Vec::with_capacity(encoded.len());
    let encoded: Vec<Option<Vec<u8>>> = (encoded.into_iter())
        .map(|(record, plane, bytes)| {
            pages.push(record);
            planes.push(plane);
            Some(bytes)
        })
        .collect();
    let laid = lay_bundles((dag, groups), order, encoded, &|_| None, scale)?;
    for (page, at) in pages.iter_mut().zip(&laid.at) {
        let (stream, offset) = at.expect("every rank of a primitive has a page");
        page["stream"] = json!(stream);
        page["streamOffset"] = json!(offset);
    }
    let max_dependencies = (laid.bundles.iter())
        .map(|bundle| bundle.dependencies.len())
        .max()
        .unwrap_or(0);
    let _t = perf::Timer::new(perf::Phase::PageWrite);
    let path = run_path(o);
    fs::create_dir_all(crate::compiler_storage::runs_dir(&o.cache))?;
    fs::write(&path, &laid.payload)?;
    Ok((
        pages,
        planes,
        Some(PageRun {
            path,
            bundles: laid.bundles,
            pinned: laid.pinned,
            dependency_bound: laid.bound,
            max_dependencies,
        }),
    ))
}
