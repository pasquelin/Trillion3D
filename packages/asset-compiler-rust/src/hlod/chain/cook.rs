//! An instance, what the merged layers take of its source and its cooking.
use super::*;
use crate::compiler::source::node_transform::Mat4;
use crate::compiler::tables::partition::HlodNode;
use crate::hlod::flatten::merge::Taken;
use crate::hlod::{chain::builds, chain::bundles, chain::SourceCover};

/// One primitive of one placed object: its HLOD 0 cell, its material, its world matrix, the
/// source cover it places, whether its object stands as itself in every actor its chain builds
/// (`HLOD_INSTANCE_MARK`, `builds::instanced`), the published node placing it — the primitives of
/// one node one object, its mesh placed whole —, that node's mesh, by its published rank, and, for
/// an instanced skinned object, the item of the animation banks it plays (`track`), its matrix
/// then its skin frame's world.
pub(crate) struct Instance<'a> {
    pub hlod: usize,
    pub material: Option<u64>,
    pub matrix: Mat4,
    pub cover: &'a SourceCover,
    pub instanced: bool,
    pub node: usize,
    pub mesh: u64,
    pub track: Option<usize>,
    /// The fallback mesh of its mesh, by its published rank (`source/fallback.rs`), where it has
    /// one: what its row stands on in the actors of an instanced layer without a cluster DAG.
    pub fallback: Option<u64>,
}

impl Instance<'_> {
    /// Which source primitive it places: its cover's address, every copy's alike.
    pub(crate) fn source(&self) -> usize {
        std::ptr::from_ref(self.cover) as usize
    }
}

/// What the job's merged layers take of their sources (`merge::Lods`): the largest screen size the
/// layers taking `Calculate` take their LOD at (`lodScreenSize`) — the finest cut any takes of a
/// source, whatever its level and its placement; a LOD's screen size is its mesh's own —, and
/// whether any takes the fallback (`Lowest`). Every merged layer reads its cell's original
/// objects. `None` when the job has no merged layer.
pub(crate) fn merged_lods(o: &Options) -> Option<Taken> {
    let hlod = o.hlod.as_ref().ok()?;
    let merged = || (hlod.layers.iter()).filter(|layer| layer.builder == crate::HlodBuilder::Merge);
    let takes = |selection: crate::HlodLodSelection| {
        merged().filter(move |layer| layer.lod_selection == selection)
    };
    let calculate = takes(crate::HlodLodSelection::Calculate)
        .map(|layer| layer.merging.lod_screen_size)
        .reduce(f64::max);
    let lowest = takes(crate::HlodLodSelection::Lowest).next().is_some();
    (calculate.is_some() || lowest).then_some(Taken { calculate, lowest })
}

/// The HLOD bundles end to end, and the table and the DAG records that describe them
/// (`records.rs`), with the cook report.
pub(crate) struct Cooked {
    pub payload: Vec<u8>,
    pub table: Vec<u8>,
    pub dag: Vec<u8>,
    pub report: Value,
}

/// The world's HLOD layers of `instances` over the chain of HLOD cells `tree`, built by `builder`,
/// and their actors.
pub(crate) fn cook(
    instances: &[Instance],
    tree: &[HlodNode],
    builder: &builds::Builder,
) -> Result<(Cooked, Vec<builds::Actor>)> {
    let (mut world, actors, rows, failures, measures) =
        builds::world_dag(instances, tree, builder)?;
    let mut cooked = bundles::pack_world(&mut world, (tree, &rows), builder.hlod)?;
    // Per HLOD level from 0, as the measures count them (`Measures`).
    let per_layer = |f: &dyn Fn(&builds::Actor) -> usize| -> Vec<usize> {
        (0..measures.stages.len())
            .map(|level| {
                (actors.iter().filter(|a| tree[a.cell].actor_level == level))
                    .map(f)
                    .sum()
            })
            .collect()
    };
    cooked.report["actorTriangles"] = json!(per_layer(&|a| a.triangles));
    // A voxel actor's voxels and bricks, per level apart from the meshes' triangles.
    cooked.report["actorVoxels"] = json!(measures.voxels);
    cooked.report["actorBricks"] = json!(measures.bricks);
    cooked.report["actors"] = json!(per_layer(&|_| 1));
    // The objects standing as themselves in each level's actors: their rows, nothing built.
    let mut actor_rows = vec![0usize; measures.stages.len()];
    for (cell, placed) in rows
        .iter()
        .enumerate()
        .filter(|(_, placed)| !placed.is_empty())
    {
        actor_rows[tree[cell].actor_level] += placed.len();
    }
    cooked.report["actorRows"] = json!(actor_rows);
    cooked.report["atlasTextures"] = json!(actors.iter().map(|a| a.images().len()).sum::<usize>());
    // Every cell whose actor could not be made, with the reason: none is dropped unsaid.
    cooked.report["actorFailures"] = json!(failures
        .iter()
        .map(|&(layer, cell, reason)| json!({"layer": layer, "cell": cell, "reason": reason}))
        .collect::<Vec<_>>());
    // What the run measured of itself — per level each step's milliseconds and its shells'
    // triangles after each step, over the whole the cores it kept busy, the jobs the room made
    // wait, the most estimated bytes at once and its estimates over what its memory grew by —:
    // what its estimates are calibrated by, the job's metrics, never its products.
    let stage = |k: usize| measures.stages.iter().map(|s| s[k]).collect::<Vec<_>>();
    cooked.report["metrics"] = json!({
        "hlodStepMs": measures.steps(),
        "hlodParallelism": measures.parallelism,
        "hlodEstimateOverPeak": measures.estimate_over_peak,
        "hlodWaited": measures.waited,
        "hlodMostBytes": measures.most_bytes,
        "hlodSolidTriangles": stage(0),
        "hlodClosedTriangles": stage(1),
        "hlodFastTriangles": stage(2),
        "hlodFirstPassTriangles": stage(3),
        "hlodToleranceTriangles": stage(4),
        "hlodFailedStageTriangles": measures.failed_stages,
        "hlodMaxActorTriangles": measures.most_triangles,
        "hlodToneGap": measures.tone_gap,
    });
    Ok((cooked, actors))
}
