use crate::compiler::hierarchy::{dag_hierarchy, ranks_of};
use crate::compiler::pages::bundles::{assign_pages, Laying};
use crate::hlod::chain::SourceCover;
use crate::*;
use trillion3d_page_codec::culling::{CULLING_MEASURES, CULLING_STRIDE};
pub(crate) struct DagResult {
    pub pages: Vec<Value>,
    /// The plane each cluster lies in, by page index, when it lies in one. Read by the coplanar
    /// stage once every primitive is compiled; never written to the cache on its own.
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// Vertices of the resident proxy coarse cut, in object space, three per vertex.
    pub proxy_cut: Vec<f32>,
    /// Error threshold, in metres, that this cut requested to fit its budget share.
    pub proxy_threshold: f64,
    /// The run of its pages' bytes (`pages.rs`), none without pages.
    pub page_run: Option<PageRun>,
    pub dag_report: Value,
    /// Stage milliseconds, reported only in progress events so caches remain reproducible.
    pub timings: Value,
    /// What the DAG has to complain about, named, also told on the progress event.
    pub warnings: Vec<Value>,
    pub culling_report: Value,
    pub structure_report: Value,
    /// The primitive's cooked collision (`physics_cook::cook_primitive`).
    pub collision: Value,
    /// Its level-0 geometry, which the world HLOD merges (`hlod::chain::stage_world_roots`).
    pub source_cover: SourceCover,
    /// The groups its far field may draw as voxels (`voxel`).
    pub voxel_seed: crate::voxel::VoxelSeed,
}
/// What a primitive's DAG is built under.
pub(crate) struct DagInputs {
    /// What its resident proxy's coarse cut must fit (`proxy::cut::cut_demand`).
    pub proxy_demand: crate::proxy::cut::CutDemand,
    /// What the merged layers take of its source, none when none does: a blended primitive's
    /// source cover merges into the world's HLOD as any (`SourceCover::of`), with the LODs it
    /// names (`Lods::of`).
    pub taken: Option<crate::hlod::flatten::merge::Taken>,
    /// How its mesh keeps its shape as its DAG is built, and what its finest level keeps
    /// (`dag::MeshShaping`).
    pub shaping: crate::dag::MeshShaping,
    /// Its first streaming pages at least are its root pages (`root_page_count`).
    pub root_pages: usize,
    /// What its mesh's build names of its pages' grid (`meshBuild`'s position, normal and tangent
    /// precisions), the grid itself following its finest clusters unless named
    /// (`geometry_page::quant::page_grid`).
    pub precision: trillion3d_page_codec::bits::grid::Precision,
    /// The largest world scale its mesh is placed at, which brings its bundles' bands to metres
    /// (`lay_bundles`).
    pub scale: Option<f64>,
}
/// The DAG of the primitive `pos`, `carried` and `index_values` describe, its pages and what the
/// later stages read of it, built under `inputs`.
pub(crate) fn build_dag_primitive(
    o: &Options,
    pos: &[f32],
    carried: &[&encode::Attribute],
    index_values: &[u32],
    inputs: DagInputs,
    encode_packed: &(impl Fn(
        &[u32],
        &[f32],
        &[&encode::Attribute],
        &[u32],
        trillion3d_page_codec::bits::grid::PageGrid,
    ) -> Result<crate::compiler::pages::record::EncodedPage>
          + Sync),
) -> Result<DagResult> {
    let DagInputs {
        proxy_demand,
        taken,
        shaping,
        root_pages,
        precision,
        scale,
    } = inputs;
    let strategy = crate::dag::DagStrategy::named(&o.simplification);
    let settings = crate::dag::DagSettings {
        strategy,
        rules: shaping.rules(),
        drop_near_collapsed: shaping.drop_near_collapsed,
        input: shaping.input,
    };
    let attributes = crate::dag::DagAttributes { carried };
    let mut laps = crate::support::perf::Laps::start();
    // `indices`: the source's triangles as the DAG read them, every corner at its exact weld's
    // first vertex — what level 0 partitions, the collider cooks and the voxels seed from —, and
    // `triangle_source` each one's rank among the source's, which the voxels sample by.
    let crate::dag::DagBuild {
        clusters: mut dag,
        mut groups,
        tallies,
        stalls,
        grown,
        indices,
        triangle_source,
    } = crate::dag::build_dag(pos, attributes, index_values, settings, &|| check(o))?;
    laps.lap("dagMs");
    let (pos, carried) = crate::dag::Grown::arrays(&grown, pos, attributes);
    let attributes = crate::dag::DagAttributes { carried: &carried };
    checks::check_dag(&dag, &indices)?;
    // The report and the world's HLOD read the DAG as built, before its finest detail is cut away:
    // the report its levels and stalls, the HLOD its level 0 — without the stored tangents, which
    // its placed copies would not turn.
    let (dag_report, warnings) = stalls::dag_report(strategy, &dag, &tallies, &stalls);
    let merged = taken.map(|taken| (taken, shaping.rules()));
    let untangled: Vec<&encode::Attribute> = (attributes.carried.iter().copied())
        .filter(|a| a.flag != trillion3d_page_codec::FLAG_TANGENT)
        .collect();
    let source_cover = SourceCover::of((&dag, &groups), (pos, &untangled[..]), merged)?;
    // The grid follows every cluster the build made, the finest detail the trim cuts away included.
    let extents = crate::dag::cut_finest(shaping.trim, (&mut dag, &mut groups), pos, &indices);
    let voxel_seed = crate::voxel::VoxelSeed::of(
        &dag,
        &groups,
        (pos, &indices, &triangle_source),
        shaping.shape,
    );
    // The proxy coarse cut is read here, where the DAG and the positions are both
    // at hand; further on, clusters exist only as cache objects.
    let (proxy_threshold, proxy_cut) = crate::proxy::cut::coarse_cut(&dag, pos, proxy_demand);
    // The pages quantize every vertex, placed or not, from where it truly is, on the grid the
    // clusters the build made call for.
    let carried = attributes.carried;
    let grid = crate::geometry_page::quant::page_grid(precision, &extents)?;
    // One box per cluster, over the positions its page decodes to, for the hierarchy and the page
    // record alike: a vertex lands on the grid's cell, up to half a cell off where it was.
    let clusters = crate::dag::bounds::culling_clusters(&grid.decoded(pos), &dag);
    // A vertex a solved reduction placed deforms as the source vertex it came from.
    let origin = grown
        .as_ref()
        .map_or(&[][..], |grown| grown.origin.as_slice());
    let encode = |slice: &[u32]| encode_packed(slice, pos, carried, origin, grid);
    let encoded = encode_clusters(o, (&dag, &clusters), pos, &encode)?;
    laps.lap("encodeMs");
    // The streaming pages first, over the encoded bytes: the cluster ranks are their fill order,
    // and the hierarchy's leaves their group parts (`compiler/hierarchy.rs`). Metres per object
    // unit, by the one rule a proxy follows, band them.
    let metres = 1.0 / trillion3d_page_codec::proxy::object_units(1.0, scale);
    // No slot of a primitive is held by a cell: every one is the pinned cover's, and the root pages
    // are its mesh's (`Laying`; only the world's HLOD holds slots, `hlod/chain/bundles.rs`). The
    // closures are made where they are read — here and on the pages' thread —, so no thread is
    // handed another's.
    let (held, root_pages_of) = (
        |_: usize| -> Option<usize> { None },
        |_: Option<usize>| root_pages,
    );
    let laying = || Laying {
        positions: pos,
        held: &held,
        root_pages: &root_pages_of,
        scale: metres,
    };
    let assigned = assign_pages((&dag, &groups), &laying(), &|slot| {
        encoded[slot].bytes.len()
    })?;
    let culled = crate::support::perf::Timer::new(crate::support::perf::Phase::Culling);
    let (order, culling) = dag_hierarchy(&dag, &clusters, &assigned);
    drop(culled);
    laps.lap("cullingMs");
    let rank_of = ranks_of(&order);
    // The collider and the pages read the same DAG and neither reads what the other writes: they
    // run side by side on the compiler's pool, each result kept in its own place, so every byte is
    // the serial cook's, and the cook's error still comes first.
    let (collision, paged) = laps.join(
        ("physicsMs", || {
            crate::physics_cook::cook_primitive(o, &dag, &order, &culling, pos, &indices)
        }),
        ("pagesMs", || {
            dag_pages(
                o,
                (&dag, &groups, &clusters),
                encoded,
                (&order, assigned, &laying()),
            )
        }),
    );
    let collision = collision?;
    let (pages, cluster_planes, page_run) = paged?;
    let mut roots: Vec<usize> = dag
        .iter()
        .enumerate()
        .filter(|(_, cluster)| cluster.is_root())
        .map(|(slot, _)| rank_of[slot])
        .collect();
    roots.sort_unstable();
    let structure_groups: Vec<Value> = groups
        .iter()
        .map(|group| {
            json!({
             "level":group.level,"error":group.error,"sphere":group.sphere,
             "children":group.children.iter().map(|&slot|rank_of[slot]).collect::<Vec<_>>(),
             "outputs":group.outputs.iter().map(|&slot|rank_of[slot]).collect::<Vec<_>>(),
            })
        })
        .collect();
    let structure_report =
        json!({"version":STRUCTURE_VERSION,"roots":roots,"groups":structure_groups});
    // Flat node array, CULLING_STRIDE numbers per node (`CullingNode::flat`); -1 marks a subtree
    // holding a root. The links and counts, behind the box, the ball and the two errors, are
    // written as integers.
    let mut flat = Vec::with_capacity(culling.len() * CULLING_STRIDE);
    for node in &culling {
        for (at, value) in node.flat().into_iter().enumerate() {
            flat.push(if at >= CULLING_MEASURES {
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
        collision,
        source_cover,
        voxel_seed,
    })
}
