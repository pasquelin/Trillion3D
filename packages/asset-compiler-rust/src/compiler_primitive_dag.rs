use super::*;

#[derive(Default)]
pub(super) struct DagResult {
    pub pages: Vec<Value>,
    /// The plane each cluster lies in, by page index, when it lies in one. Read by the coplanar
    /// stage once every primitive is compiled; never written to the cache on its own.
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// Vertices of the resident proxy coarse cut, in object space, three per vertex.
    pub proxy_cut: Vec<f32>,
    /// Error threshold, in metres, that this cut requested to fit its budget share.
    pub proxy_threshold: f64,
    pub reused: i32,
    pub dag_report: Value,
    /// What the DAG has to complain about, named: empty when it rose to its root.
    pub warnings: Vec<Value>,
    pub culling_report: Value,
    pub structure_report: Value,
    pub stream_report: Value,
    /// Grid the primitive's pages were quantized on.
    pub position_exponent: i32,
}

/// Minimum, median and maximum of a DAG level's errors. Three order statistics
/// do not need a full sort: a partial selection puts at the median rank the exact
/// element a sort would have put there — `total_cmp` is a total order — and the
/// two halves it leaves bound the minimum and the maximum. The three published
/// numbers are bit-identical to those of a full sort.
pub(super) fn level_error_stats(errors: &mut [f64]) -> (f64, f64, f64) {
    let (lower, median, upper) = errors.select_nth_unstable_by(errors.len() / 2, f64::total_cmp);
    let median = *median;
    let min = lower
        .iter()
        .copied()
        .chain([median])
        .min_by(f64::total_cmp)
        .unwrap_or(median);
    let max = upper
        .iter()
        .copied()
        .chain([median])
        .max_by(f64::total_cmp)
        .unwrap_or(median);
    (min, median, max)
}

pub(super) fn build_dag_primitive(
    o: &Options,
    pos: &[f32],
    attributes: &[geometry_page::Attribute],
    index_values: &[u32],
    proxy_demand: crate::proxy::cut::CutDemand,
    store_packed: &(impl Fn(&[u32], i32) -> Result<(Value, bool)> + Sync),
) -> Result<DagResult> {
    let strategy = crate::dag::DagStrategy::named(&o.simplification);
    // UVs, when the primitive carries them: fallback DAG weld does not cross a texture seam.
    let uvs = attributes.iter().find(|a| a.flag == geometry_page::FLAG_UV);
    let (dag, groups, tallies) = crate::dag::build_dag_tallied(
        pos,
        uvs.map(|a| &a.values[..]),
        index_values,
        strategy,
        &|| check(o),
    )?;
    if dag
        .iter()
        .filter(|c| c.level == 0)
        .map(|c| c.triangles())
        .sum::<usize>()
        != index_values.len() / 3
    {
        return Err(CompilerError::new(
            "INCOMPLETE_CLUSTER_PARTITION",
            "Level 0 clusters do not cover the source triangles",
        ));
    }
    if triangle_fingerprint(
        index_values
            .as_chunks::<3>()
            .0
            .iter()
            .map(|tri| tri.as_slice()),
    ) != triangle_fingerprint(dag.iter().filter(|c| c.level == 0).flat_map(|c| {
        c.indices
            .as_chunks::<3>()
            .0
            .iter()
            .map(|tri| tri.as_slice())
    })) {
        return Err(CompilerError::new(
            "INVALID_CLUSTER_PARTITION",
            "Level 0 clusters are not the source triangles",
        ));
    }
    // The proxy coarse cut is read here, where the DAG and the positions are both
    // at hand; further on, clusters exist only as cache objects.
    let (proxy_threshold, proxy_cut) = crate::proxy::cut::coarse_cut(&dag, pos, proxy_demand);
    let shape = compiler_primitive_warn::DagShape::of(&dag);
    let depth = shape.depth;
    let group_stats: Vec<Value> = tallies
        .iter()
        .enumerate()
        .map(|(i, tally)| {
            let mut level = tally.json();
            level["level"] = json!(i + 1);
            level
        })
        .collect();
    let warnings = compiler_primitive_warn::dag_warnings(strategy, &shape, &tallies);
    let dag_report = json!({"depth":depth,"clusterTriangles":crate::dag::DAG_CLUSTER_TRIANGLES,"groupMin":crate::dag::DAG_GROUP_MIN,"groupMax":crate::dag::DAG_GROUP_MAX,"levels":compiler_primitive_warn::level_report(&dag, depth),"groups":group_stats,"warnings":warnings});
    // Pages follow the culling order so every hierarchy node owns a contiguous page range.
    let (order, culling) = {
        let _t = perf::Timer::new(perf::Phase::Culling);
        crate::dag::build_culling_bvh(pos, &dag)
    };
    let base_id = 0usize;
    let mut page_of = vec![0usize; dag.len()];
    for (rank, &slot) in order.iter().enumerate() {
        page_of[slot] = base_id + rank;
    }
    let position_exponent = crate::geometry_page_quant::primitive_exponent(
        pos,
        dag.iter().filter(|c| c.level > 0).map(|c| c.lod_error),
    );
    let (pages, reused, stream_report) =
        bundle_dag_pages(o, &dag, &order, base_id, pos, &|slice: &[u32]| {
            store_packed(slice, position_exponent)
        })?;
    // One plane test per cluster, on the triangles it already holds: cheap next to the DAG itself,
    // and the only place the partition and the positions are both in hand.
    let cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>> = order
        .par_iter()
        .map(|&slot| {
            crate::coplanar::plane::plane_of_triangles(
                &dag[slot].indices,
                pos,
                crate::coplanar::CoplanarBounds::default().flatness_ratio,
            )
        })
        .collect();
    let mut roots: Vec<usize> = dag
        .iter()
        .enumerate()
        .filter(|(_, cluster)| cluster.is_root())
        .map(|(slot, _)| page_of[slot])
        .collect();
    roots.sort_unstable();
    let structure_groups: Vec<Value> = groups
        .iter()
        .map(|group| {
            json!({
             "level":group.level,"error":group.error,"sphere":group.sphere,
             "children":group.children.iter().map(|&slot|page_of[slot]).collect::<Vec<_>>(),
             "outputs":group.outputs.iter().map(|&slot|page_of[slot]).collect::<Vec<_>>(),
            })
        })
        .collect();
    let structure_report =
        json!({"version":STRUCTURE_VERSION,"roots":roots,"groups":structure_groups});
    // Flat node array, CULLING_STRIDE numbers per node; -1 marks a subtree holding a root.
    let mut flat = Vec::with_capacity(culling.len() * CULLING_STRIDE);
    for node in &culling {
        for a in 0..3 {
            flat.push(json!(node.min[a]));
        }
        for a in 0..3 {
            flat.push(json!(node.max[a]));
        }
        for a in 0..4 {
            flat.push(json!(node.sphere[a]));
        }
        flat.push(if node.max_parent_error.is_finite() {
            json!(node.max_parent_error)
        } else {
            json!(-1.0)
        });
        flat.push(json!(node.first_child));
        flat.push(json!(node.child_count));
        flat.push(json!(node.first_cluster));
        flat.push(json!(node.cluster_count));
    }
    let culling_report = json!({"stride":CULLING_STRIDE,"count":culling.len(),"nodes":flat});
    Ok(DagResult {
        pages,
        cluster_planes,
        proxy_cut,
        proxy_threshold,
        reused,
        dag_report,
        warnings,
        culling_report,
        structure_report,
        stream_report,
        position_exponent,
    })
}
