//! An instance, its merge error and its cooking.
use super::*;
use super::{flatten, pack, world, SourceCover};
use crate::compiler_tables::partition::HlodNode;
use crate::compiler_world::Mat4;

/// One primitive of one placed object: its HLOD 0 cell, its material, its world matrix and the
/// source cover it places.
pub(crate) struct Instance<'a> {
    pub hlod: usize,
    pub material: Option<u64>,
    pub matrix: Mat4,
    pub cover: &'a SourceCover,
}

/// The object-space error at which a merged layer of HLOD 1 takes the LOD of a source whose mesh
/// is placed at most at `scale` (`LodSelection::Calculate`): the least deviation of the job's
/// merged layers that build HLOD 1 actors, at the distance HLOD 1 is first seen from
/// (`flatten::deviation`), over the scale — the finest cut any of its placements needs. `None`
/// when no merged layer takes the sources' own LODs.
pub(crate) fn merge_lod_error(o: &Options, scale: Option<f64>) -> Option<f64> {
    let layers = &o.hlod.as_ref().ok()?.layers;
    let error = (layers.iter())
        .filter(|layer| layer.builder == crate::HlodBuilder::Instanced)
        .filter_map(|layer| layer.parent.map(|parent| &layers[parent]))
        .filter(|parent| parent.builder == crate::HlodBuilder::Merge)
        .map(|parent| flatten::deviation(parent, world::min_visible(1)))
        .reduce(f64::min)?;
    Some(error / scale.filter(|s| *s > 0.0).unwrap_or(1.0))
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
    builder: &world::Builder,
) -> Result<(Cooked, Vec<world::Actor>)> {
    let (world, actors, failures, measures) = world::world_dag(instances, tree, builder)?;
    let failed: BTreeSet<usize> = failures.iter().map(|&(_, cell, _)| cell).collect();
    let mut cooked = pack::pack_world(&world, tree, &failed)?;
    let per_layer = |f: &dyn Fn(&world::Actor) -> usize| -> Vec<usize> {
        (1..=measures.stages.len())
            .map(|level| {
                (actors
                    .iter()
                    .filter(|a| tree[a.cell].actor_level() == level))
                .map(f)
                .sum()
            })
            .collect()
    };
    cooked.report["actorTriangles"] = json!(per_layer(&|a| a.triangles));
    cooked.report["actors"] = json!(per_layer(&|_| 1));
    cooked.report["atlasTextures"] = json!(actors.iter().map(|a| a.images().len()).sum::<usize>());
    // Every cell whose actor could not be made, with the reason: none is dropped unsaid.
    cooked.report["actorFailures"] = json!(failures
        .iter()
        .map(|&(layer, cell, reason)| json!({"layer": layer, "cell": cell, "reason": reason}))
        .collect::<Vec<_>>());
    // What the run measured of itself — per level each step's milliseconds and its shells'
    // triangles after each step, over the whole the cores it kept busy and its estimates over
    // what its memory grew by —: what its estimates are calibrated by, the job's metrics, never
    // its products.
    let stage = |k: usize| measures.stages.iter().map(|s| s[k]).collect::<Vec<_>>();
    cooked.report["metrics"] = json!({
        "hlodStepMs": measures.steps(),
        "hlodParallelism": measures.parallelism,
        "hlodEstimateOverPeak": measures.estimate_over_peak,
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
