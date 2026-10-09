//! The world's pinned top: which roots pin, and what a top over the budget holds.
//!
//! A root of the world one cell alone needs — a lone object's copy, the top of a material only
//! that cell wears, a cell's super-root no material's top continued — is that cell's: held with
//! it, placed or far, never pinned (`pack_bundles`). Only the roots several cells share pin, the
//! material tops: `O(M)` over the materials and layouts the world wears, whatever its objects and
//! cells. Past the keep sphere a cell lets its roots go; the far field beyond it is not this top's.
//! A root covering no cell could be held by none, and is refused by name rather than pinned.
use super::merge::WorldDag;
use super::*;

/// Per world slot, the cell holding it when it is a root one cell alone needs, `None` for any
/// other cluster; a root covering no cell is refused, named.
pub(super) fn held_by(world: &WorldDag) -> Result<Vec<Option<usize>>> {
    let refuse = |slot: usize| {
        let (material, level) = (world.materials[slot], world.clusters[slot].level);
        CompilerError::new(
            "INVALID_WORLD_ROOTS",
            format!(
                "World root {slot} (material {material:?}, level {level}) covers no cell: no cell \
                 holds it"
            ),
        )
    };
    (0..world.clusters.len())
        .map(|slot| match world.cells[slot].as_slice() {
            _ if !world.clusters[slot].is_root() => Ok(None),
            [] => Err(refuse(slot)),
            [cell] => Ok(Some(*cell)),
            _ => Ok(None),
        })
        .collect()
}

/// One material top as the over-budget message says it: its bytes, its pages, the cells it covers.
type Top = (usize, usize, BTreeSet<usize>);

/// Refuses a pinned top over `budget`, naming the cell with the most pinned bytes over it, and
/// saying what the top holds: its pages per material and layout, how many of those tops ended on
/// one page, and the largest — a top that did not converge, its reduction stopped above it.
pub(super) fn refuse_over_budget(
    world: &WorldDag,
    pinned: &[(usize, usize)],
    (total, budget): (usize, usize),
) -> Result<()> {
    if total <= budget {
        return Ok(());
    }
    let mut per_cell: BTreeMap<usize, usize> = BTreeMap::new();
    let mut tops: BTreeMap<(Option<u64>, u32), Top> = BTreeMap::new();
    for &(slot, bytes) in pinned {
        let top = tops
            .entry((world.materials[slot], world.layouts[slot]))
            .or_default();
        (top.0, top.1) = (top.0 + bytes, top.1 + 1);
        for &cell in &world.cells[slot] {
            *per_cell.entry(cell).or_default() += bytes;
            top.2.insert(cell);
        }
    }
    let (cell, bytes) = per_cell
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .unwrap_or_default();
    let materials = tops
        .keys()
        .map(|(material, _)| material)
        .collect::<BTreeSet<_>>();
    let single = tops.values().filter(|top| top.1 == 1).count();
    let ((material, layout), (largest, pages, covered)) =
        (tops.iter().max_by_key(|(_, top)| top.0)).expect("a top over the budget pins a page");
    Err(CompilerError::new(
        "WORLD_TOP_OVER_BUDGET",
        format!(
            "The world's pinned top holds {total} bytes, over the budget of {budget}: cell {cell} \
             pins {bytes} of them. It holds {} pages in {} material tops ({} materials, each top \
             one material in one attribute layout), {single} of them on one page; the largest, \
             material {material:?} in layout {layout:#x}, holds {largest} bytes in {pages} pages \
             over {} cells",
            pinned.len(),
            tops.len(),
            materials.len(),
            covered.len()
        ),
    ))
}
