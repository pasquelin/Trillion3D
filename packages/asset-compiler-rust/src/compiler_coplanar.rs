use super::*;

/// The compiled primitives and, beside them, the plane of each of their clusters, the coarse
/// cut its proxy keeps and the vertex buffer a DAG rewrote. None travels inside the primitive:
/// each is read once by a later stage.
pub(super) type SplitCompiled = (
    Vec<Value>,
    Vec<Vec<Option<coplanar::ClusterPlane>>>,
    Vec<Vec<f32>>,
    Vec<f64>,
    Vec<compiler_source_extend::CoarseVertices>,
);
pub(super) fn split_compiled(compiled: Vec<CompiledPrimitive>) -> SplitCompiled {
    let mut primitives = Vec::with_capacity(compiled.len());
    let mut planes = Vec::with_capacity(compiled.len());
    let mut cuts = Vec::with_capacity(compiled.len());
    let mut thresholds = Vec::with_capacity(compiled.len());
    let mut coarse = Vec::new();
    for entry in compiled {
        primitives.push(entry.value);
        planes.push(entry.cluster_planes);
        cuts.push(entry.proxy_cut);
        thresholds.push(entry.proxy_threshold);
        coarse.extend(entry.coarse_vertices);
    }
    (primitives, planes, cuts, thresholds, coarse)
}

/// Everything the stage reads that is not the primitives it writes into.
pub(super) struct DepthLayerScene<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub chosen: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub cluster_planes: &'a [Vec<Option<coplanar::ClusterPlane>>],
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
        chosen,
        mesh_map,
        cluster_planes,
    } = *scene;
    let _t = perf::Timer::new(perf::Phase::Coplanar);
    let bounds = coplanar::CoplanarBounds::default();
    let source_mesh: BTreeMap<usize, usize> =
        mesh_map.iter().map(|(old, new)| (*new, *old)).collect();
    let cancelled = || check(o);
    let inputs = coplanar::CoplanarInputs {
        g,
        bin,
        chosen,
        mesh_map,
        source_mesh: &source_mesh,
        primitives,
        cluster_planes,
        offset_quantum: coplanar::offset_quantum(primitives),
        cancelled: &cancelled,
        progress: &progress,
    };
    let assigned = coplanar::assign_depth_layers(&inputs, &bounds)?;
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
