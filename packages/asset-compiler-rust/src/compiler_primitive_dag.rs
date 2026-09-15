use super::*;

#[derive(Default)]
pub(super) struct DagResult {
    pub pages: Vec<Value>,
    /// The plane each cluster lies in, by page index, when it lies in one. Read by the coplanar
    /// stage once every primitive is compiled; never written to the cache on its own.
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// Les sommets de la coupe grossière du proxy résident, en espace objet, trois par sommet.
    pub proxy_cut: Vec<f32>,
    /// Le seuil d'erreur, en mètres, que cette coupe a demandé pour tenir dans sa part du budget.
    pub proxy_threshold: f64,
    pub reused: i32,
    pub dag_report: Value,
    pub culling_report: Value,
    pub structure_report: Value,
    pub stream_report: Value,
}

/// Le minimum, la médiane et le maximum des erreurs d'un niveau du DAG. Trois statistiques d'ordre
/// ne demandent pas un tri complet : une sélection partielle met au rang médian l'élément exact que
/// le tri y aurait mis — `total_cmp` est un ordre total — et les deux moitiés qu'elle laisse bornent
/// le minimum et le maximum. Les trois nombres publiés sont bit à bit ceux du tri complet.
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
    index_values: &[u32],
    proxy_demand: crate::proxy::cut::CutDemand,
    store_packed: &(impl Fn(&[u32]) -> Result<(Value, bool)> + Sync),
) -> Result<DagResult> {
    let (dag, groups, tallies) = crate::dag::build_dag_tallied(pos, index_values, &|| check(o))?;
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
    // La coupe grossière du proxy se lit ici, où le DAG et les positions sont tous deux en main;
    // plus loin, les clusters n'existent plus que comme objets de cache.
    let (proxy_threshold, proxy_cut) = crate::proxy::cut::coarse_cut(&dag, pos, proxy_demand);
    let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
    let mut level_stats = Vec::new();
    for level in 0..=depth {
        let mut errors: Vec<f64> = Vec::new();
        let mut triangles = 0usize;
        let mut roots = 0usize;
        for cluster in dag.iter().filter(|c| c.level == level) {
            errors.push(cluster.lod_error);
            triangles += cluster.triangles();
            if cluster.is_root() {
                roots += 1;
            }
        }
        if errors.is_empty() {
            continue;
        }
        let clusters = errors.len();
        let (min, median, max) = level_error_stats(&mut errors);
        level_stats.push(json!({"level":level,"clusters":clusters,"triangles":triangles,"roots":roots,"errorMin":min,"errorMedian":median,"errorMax":max}));
    }
    let group_stats:Vec<Value>=tallies.iter().enumerate().map(|(i,tally)|json!({"level":i+1,"reduced":tally.reduced,"tooSmall":tally.too_small,"noCollapse":tally.no_collapse,"borderLost":tally.border_lost,"unusableError":tally.unusable_error})).collect();
    let dag_report = json!({"depth":depth,"clusterTriangles":crate::dag::DAG_CLUSTER_TRIANGLES,"groupMin":crate::dag::DAG_GROUP_MIN,"groupMax":crate::dag::DAG_GROUP_MAX,"levels":level_stats,"groups":group_stats});
    // Pages follow the culling order so every hierarchy node owns a contiguous page range.
    let (order, culling) = {
        let _t = perf::Timer::new(&perf::PHASES.culling);
        crate::dag::build_culling_bvh(pos, &dag)
    };
    let base_id = 0usize;
    let mut page_of = vec![0usize; dag.len()];
    for (rank, &slot) in order.iter().enumerate() {
        page_of[slot] = base_id + rank;
    }
    let (pages, reused, stream_report) =
        bundle_dag_pages(o, &dag, &order, base_id, pos, store_packed)?;
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
        culling_report,
        structure_report,
        stream_report,
    })
}
