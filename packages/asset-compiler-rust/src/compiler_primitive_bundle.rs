use super::*;
use crate::dag::{DagCluster, DagGroup};

/// Packs ranks greedily into bundles of at most `STREAM_BUNDLE_BYTES`, a bundle never empty.
fn pack(ranks: &[usize], size: impl Fn(usize) -> usize, bundles: &mut Vec<Vec<usize>>) {
    let mut current = Vec::new();
    let mut held = 0usize;
    for &rank in ranks {
        let bytes = size(rank);
        if !current.is_empty() && held + bytes > STREAM_BUNDLE_BYTES {
            bundles.push(std::mem::take(&mut current));
            held = 0;
        }
        current.push(rank);
        held += bytes;
    }
    if !current.is_empty() {
        bundles.push(current);
    }
}

/// Bundles of culling ranks, the number of pinned ones, and the bundle of every DAG slot.
///
/// Roots come first and form their own bundles, level by level: the coarsest complete cover of the
/// primitive is a handful of pinned requests. The other levels follow from the coarsest to the
/// finest, a bundle holding one level only. Within a level, clusters are sorted by the first
/// bundle holding one of their parents, then by culling rank: siblings, which share parents, land
/// in the same bundle, and a bundle depends on as few others as the spatial order allows.
pub(super) fn pack_bundles(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
) -> (Vec<Vec<usize>>, usize, Vec<usize>) {
    let size = |rank: usize| dag[order[rank]].indices.len() * 4;
    let mut bundles: Vec<Vec<usize>> = Vec::new();
    let mut bundle_of = vec![usize::MAX; dag.len()];
    let top = dag.iter().map(|cluster| cluster.level).max().unwrap_or(0);
    let place = |ranks: &mut Vec<usize>, bundles: &mut Vec<Vec<usize>>, bundle_of: &mut [usize]| {
        let first = bundles.len();
        pack(ranks, size, bundles);
        for (index, bundle) in bundles.iter().enumerate().skip(first) {
            for &rank in bundle {
                bundle_of[order[rank]] = index;
            }
        }
        ranks.clear();
    };
    let mut ranks = Vec::new();
    for level in 0..=top {
        ranks.extend((0..order.len()).filter(|&rank| {
            let cluster = &dag[order[rank]];
            cluster.is_root() && cluster.level == level
        }));
        place(&mut ranks, &mut bundles, &mut bundle_of);
    }
    let pinned = bundles.len();
    for level in (0..=top).rev() {
        let mut keyed: Vec<(usize, usize)> = (0..order.len())
            .filter(|&rank| {
                let cluster = &dag[order[rank]];
                !cluster.is_root() && cluster.level == level
            })
            .map(|rank| {
                let parents = parents_of(&dag[order[rank]], groups);
                let first = parents.iter().map(|&slot| bundle_of[slot]).min();
                (first.unwrap_or(usize::MAX), rank)
            })
            .collect();
        keyed.sort_unstable();
        ranks.extend(keyed.into_iter().map(|(_, rank)| rank));
        place(&mut ranks, &mut bundles, &mut bundle_of);
    }
    (bundles, pinned, bundle_of)
}

pub(super) fn bundle_dag_pages(
    o: &Options,
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    base_id: usize,
    pos: &[f32],
    store_packed: &(impl Fn(&[u32]) -> Result<(Value, bool)> + Sync),
) -> Result<(Vec<Value>, i32, Value)> {
    let mut pages = Vec::new();
    let mut reused = 0i32;
    let (bundles, pinned_bundles, bundle_of) = pack_bundles(dag, groups, order);
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
    let built:Vec<Bundle>=bundles.par_iter().enumerate().map(|(bundle_index,members)|->Result<Bundle>{
     check(o)?;
     let mut payload=Vec::new();
     let mut emitted=Vec::with_capacity(members.len());
     let mut reused=0i32;
     for &rank in members{
      let cluster=&dag[order[rank]];
      let offset=payload.len();
      let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
      {let _t=perf::Timer::new(perf::Phase::PageBytes);
       for &id in &cluster.indices{let index=id as usize;if index*3+2>=pos.len(){return Err(invalid("Invalid cluster index"));}payload.extend_from_slice(&id.to_le_bytes());crate::shared_math::extend_aabb(&mut min,&mut max,[pos[index*3] as f64,pos[index*3+1] as f64,pos[index*3+2] as f64]);}}
      let bytes=&payload[offset..];
      let digest={let _t=perf::Timer::new(perf::Phase::PageHash);hash(bytes)};
      let name=format!("../../objects/{}.bin",digest);let target=object_path(o,&digest);
      {let _t=perf::Timer::new(perf::Phase::PageWrite);if object_intact(&target,&digest)?.is_some(){reused+=1;}else{store_object(&target,bytes)?;}}
      let (geometry,packed_reused)={let _t=perf::Timer::new(perf::Phase::PagePacked);store_packed(&cluster.indices)?};if packed_reused{reused+=1;}
      let finite_parent=cluster.parent_error.is_finite();
      emitted.push((base_id+rank,json!({"id":base_id+rank,"url":name,"sha256":digest,"bytes":bytes.len(),"count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
       "role":if cluster.level==0{"exact"}else{"coarse"},"geometry":geometry,"level":cluster.level,
       "lodError":cluster.lod_error,"sphere":cluster.sphere,
       "parentError":if finite_parent{json!(cluster.parent_error)}else{Value::Null},
       "parentSphere":if finite_parent{json!(cluster.parent_sphere)}else{Value::Null},
       "group":match cluster.group{Some(index)=>json!(index),None=>Value::Null},
       "source":match cluster.source{Some(index)=>json!(index),None=>Value::Null},
       "stream":bundle_index,"streamOffset":offset})));
     }
     let digest={let _t=perf::Timer::new(perf::Phase::PageHash);hash(&payload)};
     let target=object_path(o,&digest);
     {let _t=perf::Timer::new(perf::Phase::PageWrite);if object_intact(&target,&digest)?.is_none(){store_object(&target,&payload)?;}}
     Ok(Bundle{url:format!("../../objects/{}.bin",digest),digest,bytes:payload.len(),count:members.len(),pages:emitted,reused})
    }).collect::<Result<Vec<_>>>()?;
    let mut ordered: Vec<Option<Value>> = vec![None; order.len()];
    let mut streams = Vec::with_capacity(built.len());
    for (bundle, dependencies) in built.into_iter().zip(dependencies) {
        reused += bundle.reused;
        streams.push(json!({"url":bundle.url,"sha256":bundle.digest,"bytes":bundle.bytes,"count":bundle.count,"dependencies":dependencies}));
        for (id, page) in bundle.pages {
            ordered[id - base_id] = Some(page);
        }
    }
    pages.reserve(ordered.len());
    for page in ordered {
        pages.push(page.ok_or_else(|| {
            CompilerError::new("INVALID_CLUSTER_PARTITION", "A cluster was not bundled")
        })?);
    }
    let stream_report = json!({"version":STRUCTURE_VERSION,"pinned":pinned_bundles,"bundleBytes":STREAM_BUNDLE_BYTES,"maxDependencies":max_dependencies,"pages":streams});
    Ok((pages, reused, stream_report))
}
