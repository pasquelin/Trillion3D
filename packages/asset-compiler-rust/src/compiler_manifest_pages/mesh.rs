//! The mesh pages: the primitives cut under `PAGE_BYTES` through the pager of the cell
//! index, written before the scene tables whose region pages name them.
use super::*;
use crate::compiler_tables::partition::split::halving;
use std::{cell::RefCell, ops::Range};

/// What a run reports of each primitive — how many of its pages it found already built — rather
/// than what it built: no page keeps it, so a cold and a warm compile write the same bytes;
/// the run's result and its pointer carry it.
pub(crate) const RUN_REPORT: &str = "reusedPages";

/// The metrics a run's settings decide — its threads, its RAM budget, the working set it admitted
/// and the waves it cut from them — which change how fast and in how much memory it compiles,
/// never what it writes.
const RUN_SETTINGS: [&str; 4] = [
    "threads",
    "ramBudgetMb",
    "admissionEstimatedBytes",
    "compileWaves",
];

/// Whether the metric `name` is what a run measured of itself — a time, its memory peak,
/// its settings — rather than what it built: the head leaves it to the run's result and
/// pointer.
pub(super) fn is_run_measure(name: &str) -> bool {
    name.ends_with("Ms") || name == "peakRssBytes" || RUN_SETTINGS.contains(&name)
}

/// `page` without the run's report of its primitives.
pub(super) fn without_run_report(mut page: Value) -> Value {
    for primitive in page[MANIFEST_PAGES.records]
        .as_array_mut()
        .into_iter()
        .flatten()
    {
        primitive.as_object_mut().map(|p| p.remove(RUN_REPORT));
    }
    page
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
/// is one primitive, or primitives whose page fits `PAGE_BYTES`, each with its own sidecar.
pub(crate) fn write_mesh_pages(primitives: &[Value], directory: &Path) -> Result<MeshPages> {
    let kind = &MANIFEST_PAGES;
    let whole = without_run_report(columns(&Map::new(), primitives, &TEMPLATES, &[])?.0);
    let slim = whole[kind.records]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let kept = RefCell::new(BTreeSet::new());
    let leaf = |range: Range<usize>, written: bool| {
        let place = written.then_some(directory);
        let (page, sha256) = columned(&Map::new(), &primitives[range], &[], place)?;
        if written {
            kept.borrow_mut().insert(sha256);
        }
        Ok(page)
    };
    let mut pager = Pager::new(kind, slim, None, directory, &leaf, None)?;
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
