//! The mesh pages: the primitives cut under `PAGE_BYTES` through the pager of the cell
//! index, written before the scene tables whose region pages name them.
use super::*;
use crate::compiler::tables::partition::split::halving;
use std::cell::RefCell;

/// What a run reports of each primitive — how many of its pages it found already built — rather
/// than what it built: no page keeps it, so a cold and a warm compile write the same bytes;
/// the run's result and its pointer carry it.
pub(crate) const RUN_REPORT: &str = "reusedPages";

/// The metrics a run's settings decide — its threads, its RAM budget, the working set it admitted,
/// the jobs its room made wait, the cores its HLOD kept busy, its estimates over its memory, the
/// HLOD jobs its room made wait and the most bytes they ran at once —, which change how fast and
/// in how much memory it compiles, never what it writes.
const RUN_SETTINGS: [&str; 8] = [
    "threads",
    "ramBudgetMb",
    "admissionEstimatedBytes",
    "compileWaited",
    "hlodParallelism",
    "hlodEstimateOverPeak",
    "hlodWaited",
    "hlodMostBytes",
];

/// The HLOD shells' triangles after each step and the most one actor holds, per layer:
/// diagnostics of the run, never what the head describes.
const HLOD_STAGES: [&str; 7] = [
    "hlodSolidTriangles",
    "hlodClosedTriangles",
    "hlodFastTriangles",
    "hlodFirstPassTriangles",
    "hlodToleranceTriangles",
    "hlodFailedStageTriangles",
    "hlodMaxActorTriangles",
];

/// Whether the metric `name` is what a run measured of itself — a time, its memory peak,
/// its settings — rather than what it built: the head leaves it to the run's result and
/// pointer.
pub(super) fn is_run_measure(name: &str) -> bool {
    name.ends_with("Ms")
        || name == "peakRssBytes"
        || RUN_SETTINGS.contains(&name)
        || HLOD_STAGES.contains(&name)
}

/// The mesh pages of a compile, written before the tables whose region pages name them.
pub(crate) struct MeshPages {
    /// The root's slots, the empty ones last.
    pub slots: Vec<String>,
    /// The slots of the region pages each mesh's primitives lie in, by mesh rank.
    pub by_mesh: MeshSlots,
    /// The fingerprints of every page and sidecar written, which the sweep keeps.
    pub(super) kept: BTreeSet<String>,
}

/// Writes `primitives` in order as mesh pages in `directory`, cut through the pager: a region page
/// is one primitive, or primitives whose page fits `PAGE_BYTES`, each with its own sidecar, a
/// bundle naming its container by its rank among the `file_count` geometry files. The columns are encoded
/// once, each page cut from them; the head alone lists the files, which every page reads.
pub(crate) fn write_mesh_pages(
    primitives: &[Value],
    file_count: usize,
    directory: &Path,
) -> Result<MeshPages> {
    let kind = &MANIFEST_PAGES;
    let mut encoded = Encoded::new(primitives, file_count)?;
    for primitive in &mut encoded.slim {
        primitive.as_object_mut().map(|p| p.remove(RUN_REPORT));
    }
    let top = Map::new();
    let kept = RefCell::new(BTreeSet::new());
    let leaf = |range: Range<usize>, measured: Option<Value>| match measured {
        None => columned(&top, (&encoded, range), &[], None).map(|(page, _)| page),
        Some(mut page) => {
            let bytes = encoded.bytes(range, &[])?;
            kept.borrow_mut()
                .insert(seal(&mut page, &bytes, Some(directory))?);
            Ok(page)
        }
    };
    let mut pager = Pager::new(kind, &encoded.slim, None, directory, &leaf, None)?;
    let (slots, _) = pager.root(&halving(0..primitives.len()))?;
    let mut by_mesh = MeshSlots::new();
    for (records, slot) in pager.written {
        kept.borrow_mut().insert(slot[..64].to_string());
        let Some(records) = records else { continue };
        for mesh in primitives[records]
            .iter()
            .filter_map(|p| p["mesh"].as_u64())
        {
            let pages: &mut Vec<String> = by_mesh.entry(mesh).or_default();
            if pages.last() != Some(&slot) {
                pages.push(slot.clone());
            }
        }
    }
    let kept = kept.into_inner();
    Ok(MeshPages {
        slots,
        by_mesh,
        kept,
    })
}
