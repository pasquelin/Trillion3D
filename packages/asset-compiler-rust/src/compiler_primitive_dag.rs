use super::*;
use crate::compiler_world_roots::SourceCover;
use trillion3d_page_codec::culling::{build_culling_bvh, CULLING_STRIDE};
pub(super) struct DagResult {
    pub pages: Vec<Value>,
    /// The plane each cluster lies in, by page index, when it lies in one. Read by the coplanar
    /// stage once every primitive is compiled; never written to the cache on its own.
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// Vertices of the resident proxy coarse cut, in object space, three per vertex.
    pub proxy_cut: Vec<f32>,
    /// Error threshold, in metres, that this cut requested to fit its budget share.
    pub proxy_threshold: f64,
    /// The run of its pages' bytes (`compiler_primitive_pages.rs`), none without pages.
    pub page_run: Option<PageRun>,
    pub dag_report: Value,
    /// Stage milliseconds, reported only in progress events so caches remain reproducible.
    pub timings: Value,
    /// What the DAG has to complain about, named, also told on the progress event.
    pub warnings: Vec<Value>,
    pub culling_report: Value,
    pub structure_report: Value,
    /// Grid the primitive's pages were quantized on.
    pub position_exponent: i32,
    /// The primitive's cooked collision (`physics_cook::cook_primitive`).
    pub collision: Value,
    /// Its level-0 geometry, which the world HLOD merges (`compiler_world_roots`).
    pub source_cover: SourceCover,
    /// The groups its far field may draw as voxels (`voxel`).
    pub voxel_seed: crate::voxel::VoxelSeed,
}
/// `tile_log2` is the primitive's tile of the world in object units: its pages' grid follows it
/// (`geometry_page_quant::tile`). `scale` is the largest world scale its mesh is placed at, which
/// brings its bundles' bands to metres (`lay_bundles`). A `blended` primitive is drawn sorted; its source
/// cover merges into the world's HLOD as any (`SourceCover::of`).
#[allow(clippy::too_many_arguments)]
pub(super) fn build_dag_primitive(
    o: &Options,
    pos: &[f32],
    carried: &[&encode::Attribute],
    index_values: &[u32],
    proxy_demand: crate::proxy::cut::CutDemand,
    blended: bool,
    shape: crate::voxel::ShapePreservation,
    (tile_log2, scale): (i32, Option<f64>),
    encode_packed: &(impl Fn(
        &[u32],
        &[f32],
        &[&encode::Attribute],
        &[u32],
        i32,
    ) -> Result<compiler_page_record::EncodedPage>
          + Sync),
) -> Result<DagResult> {
    let strategy = crate::dag::DagStrategy::named(&o.simplification);
    let attributes = crate::dag::DagAttributes { carried };
    let mut laps = perf::Laps::start();
    let crate::dag::DagBuild {
        clusters: dag,
        groups,
        tallies,
        stalls,
        grown,
    } = crate::dag::build_dag(pos, attributes, index_values, strategy, &|| check(o))?;
    laps.lap("dagMs");
    let (pos, carried) = crate::dag::Grown::arrays(&grown, pos, attributes);
    let attributes = crate::dag::DagAttributes { carried: &carried };
    compiler_primitive_checks::check_dag(&dag, index_values)?;
    let voxel_seed = crate::voxel::VoxelSeed::of(&dag, &groups, pos, index_values, shape);
    // The proxy coarse cut is read here, where the DAG and the positions are both
    // at hand; further on, clusters exist only as cache objects.
    let (proxy_threshold, proxy_cut) = crate::proxy::cut::coarse_cut(&dag, pos, proxy_demand);
    let (dag_report, warnings) =
        compiler_primitive_stalls::dag_report(strategy, &dag, &tallies, &stalls);
    let position_exponent = crate::geometry_page_quant::primitive_exponent(
        pos,
        dag.iter().filter(|c| c.level > 0).map(|c| c.lod_error),
        blended,
        tile_log2,
    );
    // The pages quantize every vertex, placed or not, from where it truly is: their error bounds
    // it.
    let carried = attributes.carried;
    // One box per cluster, over the drawn positions, for the hierarchy and the page record alike.
    let clusters = crate::dag::bounds::culling_clusters(pos, &dag);
    let culled = perf::Timer::new(perf::Phase::Culling);
    let (order, culling) = build_culling_bvh(&clusters);
    drop(culled);
    laps.lap("cullingMs");
    // Pages follow the culling order so every hierarchy node owns a contiguous page range.
    let mut page_of = vec![0usize; dag.len()];
    (order.iter().enumerate()).for_each(|(rank, &slot)| page_of[slot] = rank);
    // The collider and the pages read the same DAG and neither reads what the other writes: they
    // run side by side on the compiler's pool, each result kept in its own place, so every byte is
    // the serial cook's, and the cook's error still comes first.
    let (collision, paged) = laps.join(
        ("physicsMs", || {
            crate::physics_cook::cook_primitive(o, &dag, &order, &culling, pos, index_values)
        }),
        ("pagesMs", || {
            // A vertex a solved reduction placed deforms as the source vertex it came from.
            let origin = grown
                .as_ref()
                .map_or(&[][..], |grown| grown.origin.as_slice());
            let encode =
                |slice: &[u32]| encode_packed(slice, pos, carried, origin, position_exponent);
            // Metres per object unit, by the one rule a tile and a proxy follow.
            let metres = 1.0 / trillion3d_page_codec::bits::grid::object_units(1.0, scale);
            dag_pages(
                o,
                (&dag, &groups, &clusters),
                (&order, metres),
                pos,
                &encode,
            )
        }),
    );
    let collision = collision?;
    let (pages, cluster_planes, page_run) = paged?;
    let merged = crate::compiler_world_roots::merge_lod_error(o, scale);
    let source_cover = SourceCover::of(strategy, &dag, (pos, carried), merged);
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
    // Flat node array, CULLING_STRIDE numbers per node (`CullingNode::flat`); -1 marks a subtree
    // holding a root. The links and counts are written as integers.
    let mut flat = Vec::with_capacity(culling.len() * CULLING_STRIDE);
    for node in &culling {
        for (at, value) in node.flat().into_iter().enumerate() {
            flat.push(if at > 10 {
                json!(value as usize)
            } else {
                json!(value)
            });
        }
    }
    let culling_report = json!({"stride":CULLING_STRIDE,"count":culling.len(),"nodes":flat});
    laps.lap("reportMs");
    Ok(DagResult {
        pages,
        cluster_planes,
        proxy_cut,
        proxy_threshold,
        page_run,
        dag_report,
        timings: laps.report(),
        warnings,
        culling_report,
        structure_report,
        position_exponent,
        collision,
        source_cover,
        voxel_seed,
    })
}
