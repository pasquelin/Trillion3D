//! A primitive's pages: each cluster's geometry page encoded, its record, and the pages assigned
//! to streaming pages — the unit a runtime reads, installs, keeps and drops
//! (`../pages/bundles.rs`) —, their bytes end to end in the primitive's run, a scratch file the
//! geometry containers take once every primitive is compiled (`../pages/containers.rs`), then
//! remove. No page is a file of its own, and no run is an object.
use crate::compiler::pages::bundles::{lay_bundles, Assignment, Bundle, Laying};
use crate::coplanar::plane::plane_of_triangles;
use crate::coplanar::ClusterPlane;
use crate::dag::{DagCluster, DagGroup};
use crate::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use trillion3d_page_codec::culling::CullingCluster;
use trillion3d_page_codec::faces::face_crosses;

/// The run of a primitive's pages: their bundles end to end in the scratch file at `path` until the
/// containers take them, and its bundles in run order.
#[derive(Clone, Debug)]
pub(crate) struct PageRun {
    pub path: PathBuf,
    pub bundles: Vec<Bundle>,
    /// The root pages, first in the run.
    pub pinned: usize,
    /// The most pages a page needs directly, and the longest closed list.
    pub dependency_bound: usize,
    pub max_dependencies: usize,
}

/// A run's scratch file, unique within the process and among the processes sharing the cache.
fn run_path(o: &Options) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let rank = NEXT.fetch_add(1, Ordering::Relaxed);
    crate::compiler::cache::storage::runs_dir(&o.cache)
        .join(format!("{}-{rank}.bin", std::process::id()))
}

/// Pages, by culling rank: their records, the plane each cluster lies in, when it lies in one
/// (`coplanar::plane`), and their run.
pub(crate) type DagPages = (Vec<Value>, Vec<Option<ClusterPlane>>, Option<PageRun>);

/// One cluster's page as encoded, by DAG slot, before any rank is known: its geometry descriptor,
/// its bytes and the plane it lies in, when it lies in one.
pub(crate) struct EncodedCluster {
    geometry: Value,
    pub bytes: Vec<u8>,
    plane: Option<ClusterPlane>,
}

/// Each cluster of `dag`, by DAG slot, its geometry page encoded by `encode` and its plane tested
/// on the face crosses and the box its record measures (`boxes`, `dag::bounds::culling_clusters`):
/// what the page assignment weighs (`assign_pages`) and the records are written from.
pub(crate) fn encode_clusters(
    o: &Options,
    (dag, boxes): (&[DagCluster], &[CullingCluster]),
    pos: &[f32],
    encode: &(impl Fn(&[u32]) -> Result<crate::compiler::pages::record::EncodedPage> + Sync),
) -> Result<Vec<EncodedCluster>> {
    let flatness = crate::coplanar::CoplanarBounds::default().flatness_ratio;
    (dag.par_iter().zip(boxes))
        .map(|(cluster, &CullingCluster { min, max, .. })| {
            check(o)?;
            // Every index names a vertex of `pos`: the source's were checked once, where they are
            // read (`triangles::read`), and the DAG names no other than those and what it placed.
            let (geometry, bytes) = {
                let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::PagePacked);
                encode(&cluster.indices)?
            };
            // The plane is the source's, which the coplanar merge reads.
            let crosses = face_crosses(pos, &cluster.indices);
            let plane = plane_of_triangles((&cluster.indices, pos), &crosses, (min, max), flatness);
            Ok(EncodedCluster {
                geometry,
                bytes,
                plane,
            })
        })
        .collect()
}

/// The records of the pages of `dag` in culling `order` (rank → slot), each from its cluster's
/// page as `encoded`, assigned to streaming pages as `assigned` (`assign_pages`, whose fill order
/// `order` is) and laid end to end in the primitive's run (`PageRun`, `lay_bundles`). A page names
/// its streaming page (`stream`) and its place there (`streamOffset`).
pub(crate) fn dag_pages(
    o: &Options,
    (dag, groups, boxes): (&[DagCluster], &[DagGroup], &[CullingCluster]),
    encoded: Vec<EncodedCluster>,
    (order, assigned, laying): (&[usize], Assignment, &Laying),
) -> Result<DagPages> {
    if encoded.is_empty() {
        return Ok((Vec::new(), Vec::new(), None));
    }
    let (mut pages, mut planes) = (Vec::with_capacity(order.len()), Vec::new());
    // Each cluster's page bytes by DAG slot, as the layout reads them.
    let mut bytes_of: Vec<Vec<u8>> = Vec::with_capacity(encoded.len());
    let mut taken: Vec<Option<Value>> = Vec::with_capacity(encoded.len());
    let mut planes_of = Vec::with_capacity(encoded.len());
    for EncodedCluster {
        geometry,
        bytes,
        plane,
    } in encoded
    {
        bytes_of.push(bytes);
        taken.push(Some(geometry));
        planes_of.push(plane);
    }
    for (rank, &slot) in order.iter().enumerate() {
        let geometry = taken[slot].take().expect("each slot ranked once");
        let CullingCluster { min, max, .. } = boxes[slot];
        let record =
            crate::compiler::pages::record::page_record((rank, &dag[slot]), (min, max), geometry);
        pages.push(record);
        planes.push(planes_of[slot].take());
    }
    let laid = lay_bundles((dag, groups), bytes_of, (assigned, laying))?;
    for (rank, page) in pages.iter_mut().enumerate() {
        let (stream, offset) = laid.at[order[rank]];
        page["stream"] = json!(stream);
        page["streamOffset"] = json!(offset);
    }
    let max_dependencies = (laid.bundles.iter())
        .map(|bundle| bundle.dependencies.len())
        .max()
        .unwrap_or(0);
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::PageWrite);
    let path = run_path(o);
    fs::create_dir_all(crate::compiler::cache::storage::runs_dir(&o.cache))?;
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
