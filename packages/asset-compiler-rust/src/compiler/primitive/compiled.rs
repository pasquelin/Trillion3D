use crate::*;

/// The compiled primitives and, beside each, what a later stage reads once: none travels inside the
/// primitive.
pub(crate) struct SplitCompiled {
    pub primitives: Vec<Value>,
    /// The plane of each of its clusters, which the coplanar stage stacks.
    pub cluster_planes: Vec<Vec<Option<crate::coplanar::ClusterPlane>>>,
    pub collisions: Vec<Value>,
    /// Its level-0 geometry, which the world HLOD merges (`hlod::chain::stage_world_roots`).
    pub covers: Vec<crate::hlod::chain::SourceCover>,
    /// The groups its far field may draw as voxels.
    pub voxel_seeds: Vec<crate::voxel::VoxelSeed>,
    /// The run of its pages' bundles, which the geometry containers take; `None` without pages.
    pub runs: Vec<Option<PageRun>>,
    /// The tree of its coarse cut (`ray_tracing`), none when the cut holds no triangle.
    pub ray_tracing: Vec<Option<crate::ray_tracing::PrimitiveTree>>,
}
pub(crate) fn split_compiled(compiled: Vec<CompiledPrimitive>) -> SplitCompiled {
    let mut split = SplitCompiled {
        primitives: Vec::with_capacity(compiled.len()),
        cluster_planes: Vec::with_capacity(compiled.len()),
        collisions: Vec::with_capacity(compiled.len()),
        covers: Vec::with_capacity(compiled.len()),
        voxel_seeds: Vec::with_capacity(compiled.len()),
        runs: Vec::with_capacity(compiled.len()),
        ray_tracing: Vec::with_capacity(compiled.len()),
    };
    for entry in compiled {
        split.runs.push(entry.page_run);
        split.primitives.push(entry.value);
        split.cluster_planes.push(entry.cluster_planes);
        split.collisions.push(entry.collision);
        split.covers.push(entry.source_cover);
        split.voxel_seeds.push(entry.voxel_seed);
        split.ray_tracing.push(entry.ray_tracing);
    }
    split
}

/// Everything the stage reads that is not the primitives it writes into.
pub(crate) struct DepthLayerScene<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    /// The chosen nodes no hidden node hides: what the drawn scene derives from.
    pub shown: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub cluster_planes: &'a [Vec<Option<crate::coplanar::ClusterPlane>>],
    /// Node transforms and primitives by mesh, computed once for the job.
    pub placement: &'a crate::proxy::placement::Placement,
}

/// Stacks the coplanar opaque surfaces of the whole scene and writes the layer it decided on every
/// cluster of a stacked surface. Runs once, here, where every primitive is compiled and the node
/// hierarchy that places them is still in hand. Returns the stage's report.
pub(crate) fn stage_depth_layers(
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
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::Coplanar);
    let bounds = crate::coplanar::CoplanarBounds::default();
    let source_mesh: BTreeMap<usize, usize> =
        mesh_map.iter().map(|(old, new)| (*new, *old)).collect();
    let cancelled = || check(o);
    let inputs = crate::coplanar::CoplanarInputs {
        g,
        bin,
        shown,
        mesh_map,
        source_mesh: &source_mesh,
        primitives,
        cluster_planes,
        offset_quantum: crate::coplanar::offset_quantum(primitives),
        cancelled: &cancelled,
        progress: &progress,
    };
    let assigned = crate::coplanar::assign_depth_layers(&inputs, &bounds, &placement.world)?;
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
