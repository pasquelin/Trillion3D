use super::*;
use crate::dag::{DagCluster, DagGroup};
use trillion3d_math::{aabb::extend_aabb, vec3::point};

mod pack;
pub(crate) use pack::{index_bytes, pack_bundles, pack_primitive};

pub(super) fn bundle_dag_pages(
    o: &Options,
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    pos: &[f32],
    store_packed: &(impl Fn(&[u32]) -> Result<(Value, bool)> + Sync),
) -> Result<(Vec<Value>, i32, Value)> {
    let mut pages = Vec::new();
    let mut reused = 0i32;
    let bound = dependency_bound(dag, groups);
    let (bundles, pinned_bundles, bundle_of) = pack_primitive(dag, groups, order, bound)?;
    let direct = direct_dependencies(dag, groups, &bundle_of, bundles.len());
    let dependencies = close_dependencies(&direct)?;
    verify_dependencies(
        dag,
        groups,
        order,
        &bundle_of,
        &dependencies,
        pinned_bundles,
    )?;
    let max_dependencies = dependencies.iter().map(Vec::len).max().unwrap_or(0);
    struct Bundle {
        url: String,
        digest: String,
        bytes: usize,
        count: usize,
        pages: Vec<(usize, Value)>,
        reused: i32,
    }
    let built: Vec<Bundle> = bundles
        .par_iter()
        .enumerate()
        .map(|(bundle_index, members)| -> Result<Bundle> {
            check(o)?;
            let mut payload = Vec::new();
            let mut emitted = Vec::with_capacity(members.len());
            let mut reused = 0i32;
            for &rank in members {
                let cluster = &dag[order[rank]];
                let offset = payload.len();
                // The box grows in the pass that writes the indices.
                let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
                {
                    let _t = perf::Timer::new(perf::Phase::PageBytes);
                    for &id in &cluster.indices {
                        if id as usize * 3 + 2 >= pos.len() {
                            return Err(invalid("Invalid cluster index"));
                        }
                        payload.extend_from_slice(&id.to_le_bytes());
                        extend_aabb(&mut min, &mut max, point(pos, id));
                    }
                }
                let bytes = &payload[offset..];
                let digest = {
                    let _t = perf::Timer::new(perf::Phase::PageHash);
                    hash(bytes)
                };
                let target = object_path(o, &digest);
                {
                    let _t = perf::Timer::new(perf::Phase::PageWrite);
                    if object_intact(&target, &digest)?.is_some() {
                        reused += 1;
                    } else {
                        store_object(&target, bytes)?;
                    }
                }
                let (geometry, packed_reused) = {
                    let _t = perf::Timer::new(perf::Phase::PagePacked);
                    store_packed(&cluster.indices)?
                };
                if packed_reused {
                    reused += 1;
                }
                let cone = trillion3d_page_codec::normal_cone::triangle_cone(pos, &cluster.indices);
                emitted.push((
                    rank,
                    compiler_page_object::page_record(
                        (rank, cluster),
                        (&digest, bytes.len()),
                        (min, max),
                        cone,
                        geometry,
                        (bundle_index, offset),
                    ),
                ));
            }
            let digest = {
                let _t = perf::Timer::new(perf::Phase::PageHash);
                hash(&payload)
            };
            let target = object_path(o, &digest);
            {
                let _t = perf::Timer::new(perf::Phase::PageWrite);
                if object_intact(&target, &digest)?.is_none() {
                    store_object(&target, &payload)?;
                }
            }
            Ok(Bundle {
                url: format!("../../objects/{}.bin", digest),
                digest,
                bytes: payload.len(),
                count: members.len(),
                pages: emitted,
                reused,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut ordered: Vec<Option<Value>> = vec![None; order.len()];
    let mut streams = Vec::with_capacity(built.len());
    for (bundle, dependencies) in built.into_iter().zip(dependencies) {
        reused += bundle.reused;
        streams.push(json!({"url":bundle.url,"sha256":bundle.digest,"bytes":bundle.bytes,"count":bundle.count,"dependencies":dependencies}));
        for (id, page) in bundle.pages {
            ordered[id] = Some(page);
        }
    }
    pages.reserve(ordered.len());
    for page in ordered {
        pages.push(page.ok_or_else(|| {
            CompilerError::new("INVALID_CLUSTER_PARTITION", "A cluster was not bundled")
        })?);
    }
    let stream_report = json!({"version":STRUCTURE_VERSION,"pinned":pinned_bundles,"bundleBytes":STREAM_BUNDLE_BYTES,"dependencyBound":bound,"maxDependencies":max_dependencies,"pages":streams});
    Ok((pages, reused, stream_report))
}
