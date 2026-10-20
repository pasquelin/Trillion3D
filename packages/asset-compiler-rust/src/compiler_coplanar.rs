use super::*;

/// The compiled primitives and, beside each, what a later stage reads once: none travels inside the
/// primitive.
pub(super) struct SplitCompiled {
    pub primitives: Vec<Value>,
    /// The plane of each of its clusters, which the coplanar stage stacks.
    pub cluster_planes: Vec<Vec<Option<coplanar::ClusterPlane>>>,
    /// The coarse cut its proxy keeps, in object space, and the threshold it requested, in metres.
    pub proxy_cuts: Vec<Vec<f32>>,
    pub proxy_thresholds: Vec<f64>,
    pub collisions: Vec<Value>,
    /// Its level-0 geometry, which the world HLOD merges (`compiler_world_roots`).
    pub covers: Vec<crate::compiler_world_roots::SourceCover>,
    /// The groups its far field may draw as voxels.
    pub voxel_seeds: Vec<crate::voxel::VoxelSeed>,
    /// The run of its pages' bundles, which the geometry containers take; `None` without pages.
    pub runs: Vec<Option<PageRun>>,
}
pub(super) fn split_compiled(compiled: Vec<CompiledPrimitive>) -> SplitCompiled {
    let mut split = SplitCompiled {
        primitives: Vec::with_capacity(compiled.len()),
        cluster_planes: Vec::with_capacity(compiled.len()),
        proxy_cuts: Vec::with_capacity(compiled.len()),
        proxy_thresholds: Vec::with_capacity(compiled.len()),
        collisions: Vec::with_capacity(compiled.len()),
        covers: Vec::with_capacity(compiled.len()),
        voxel_seeds: Vec::with_capacity(compiled.len()),
        runs: Vec::with_capacity(compiled.len()),
    };
    for entry in compiled {
        split.runs.push(entry.page_run);
        split.primitives.push(entry.value);
        split.cluster_planes.push(entry.cluster_planes);
        split.proxy_cuts.push(entry.proxy_cut);
        split.proxy_thresholds.push(entry.proxy_threshold);
        split.collisions.push(entry.collision);
        split.covers.push(entry.source_cover);
        split.voxel_seeds.push(entry.voxel_seed);
    }
    split
}

/// Everything the stage reads that is not the primitives it writes into.
pub(super) struct DepthLayerScene<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    /// The chosen nodes no hidden node hides: what the drawn scene derives from.
    pub shown: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub cluster_planes: &'a [Vec<Option<coplanar::ClusterPlane>>],
    /// Node transforms and primitives by mesh, computed once for the job.
    pub placement: &'a proxy::placement::Placement,
}

/// Stacks the coplanar opaque surfaces of the whole scene and writes the layer it decided on every
/// cluster of a stacked surface. Runs once, here, where every primitive is compiled and the node
/// hierarchy that places them is still in hand. Returns the stage's report.
pub(super) fn stage_depth_layers(
    scene: &DepthLayerScene<'_>,
    primitives: &mut [Value],
    progress: impl Fn(Value) + Sync,
) -> Result<Value> {
    let DepthLayerScene {
        o,
        g,
        bin,
        shown,
        mesh_map,
        cluster_planes,
        placement,
    } = *scene;
    let _t = perf::Timer::new(perf::Phase::Coplanar);
    let bounds = coplanar::CoplanarBounds::default();
    let source_mesh: BTreeMap<usize, usize> =
        mesh_map.iter().map(|(old, new)| (*new, *old)).collect();
    let cancelled = || check(o);
    let inputs = coplanar::CoplanarInputs {
        g,
        bin,
        shown,
        mesh_map,
        source_mesh: &source_mesh,
        primitives,
        cluster_planes,
        offset_quantum: coplanar::offset_quantum(primitives),
        cancelled: &cancelled,
        progress: &progress,
    };
    let assigned = coplanar::assign_depth_layers(&inputs, &bounds, &placement.world)?;
    for (index, layers) in assigned.layers.iter().enumerate() {
        for (page, layer) in layers.iter().enumerate() {
            if *layer == 0 {
                continue;
            }
            primitives[index]["pages"][page]["depthLayer"] = json!(layer);
        }
    }
    progress(json!({"phase":"coplanar","step":"done","completed":1,"total":1}));
    Ok(assigned.report)
}
