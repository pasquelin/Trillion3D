use super::*;

pub(super) fn bundle_dag_pages(
    o: &Options,
    dag: &[crate::dag::DagCluster],
    order: &[usize],
    base_id: usize,
    pos: &[f32],
    store_packed: &(impl Fn(&[u32]) -> Result<(Value, bool)> + Sync),
) -> Result<(Vec<Value>, i32, Value)> {
    let mut pages = Vec::new();
    let mut reused = 0i32;
    // Bundles group clusters of one level that the culling order already placed next to each other.
    // Root clusters come first and form their own bundles, so the coarsest complete cover of the
    // primitive is a handful of pinned requests.
    let mut bundle_order: Vec<usize> = (0..order.len()).collect();
    bundle_order.sort_by_key(|&rank| {
        let cluster = &dag[order[rank]];
        (
            if cluster.is_root() { 0u8 } else { 1u8 },
            cluster.level,
            rank,
        )
    });
    // The greedy packing in `compiler_bundles.rs` is not this one: there a single
    // size threshold closes a bundle, here a key break (root, level) closes it too.
    // Two rules, two loops; parameterising them together would treat the key as an
    // option.
    let mut bundles: Vec<Vec<usize>> = Vec::new();
    {
        let mut current: Vec<usize> = Vec::new();
        let mut held = 0usize;
        let mut key = None;
        for &rank in &bundle_order {
            let cluster = &dag[order[rank]];
            let next_key = (cluster.is_root(), cluster.level);
            let size = cluster.indices.len() * 4;
            if !current.is_empty() && (key != Some(next_key) || held + size > STREAM_BUNDLE_BYTES) {
                bundles.push(std::mem::take(&mut current));
                held = 0;
            }
            key = Some(next_key);
            current.push(rank);
            held += size;
        }
        if !current.is_empty() {
            bundles.push(current);
        }
    }
    let pinned_bundles = bundles
        .iter()
        .take_while(|bundle| dag[order[bundle[0]]].is_root())
        .count();
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
    for bundle in built {
        reused += bundle.reused;
        streams.push(json!({"url":bundle.url,"sha256":bundle.digest,"bytes":bundle.bytes,"count":bundle.count}));
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
    let stream_report = json!({"version":STRUCTURE_VERSION,"pinned":pinned_bundles,"bundleBytes":STREAM_BUNDLE_BYTES,"pages":streams});
    Ok((pages, reused, stream_report))
}
