//! The world DAG in streaming bundles (`compiler_page_bundles.rs`), linked by
//! `compiler_bundle_dependencies.rs`: nothing pinned — every root is its HLOD 0 cell's, packed in
//! bundles of that cell's roots alone (`pack_bundles`, `held`), held while its actor is loaded: an HLOD
//! actor streams with its own cell, so its pages come and go with that cell's range alone — then every level from the coarsest, each page's bundle needing its parents' up to its cell's
//! roots.
use super::dag_records::encode_dag;
use super::merge::WorldDag;
use super::records::{encode_table, Page, CHAIN_ACTOR_FAILED};
use super::*;
use crate::compiler_page_bundles::lay_bundles;
use crate::compiler_tables::partition::HlodNode;

/// Packs `world` and lays its pages (`lay_bundles`: every page reaches its HLOD 0 cell's roots),
/// and returns the payload of the bundles with the table and the DAG records that describe them,
/// written straight from the world (`records.rs`); `tree` the partition's chain of HLOD cells,
/// `failed` the cells whose actor could not be made.
pub(super) fn pack_world(
    world: &WorldDag,
    tree: &[HlodNode],
    failed: &BTreeSet<usize>,
) -> Result<Cooked> {
    let (dag, groups) = (&world.clusters, &world.groups);
    // The world lies in its culling order already (`WorldDag::in_culling_order`): rank is slot.
    let order: Vec<usize> = (0..dag.len()).collect();
    let pages = world
        .pages
        .iter()
        .map(|page| Some(page.bytes.as_slice()))
        .collect();
    let held = |slot: usize| dag[slot].is_root().then(|| world.hlod(slot));
    // World pages are in world space: their bands are in metres already.
    let laid = lay_bundles((dag, groups), &order, pages, &held, 1.0)?;
    // Each page in the binary's order, by its bundle and its offset there.
    let mut written: Vec<(usize, (usize, usize))> = (laid.at.iter().enumerate())
        .filter_map(|(slot, at)| at.map(|at| (slot, at)))
        .collect();
    written.sort_unstable_by_key(|&(_, at)| at);
    let pages: Vec<Page> = (written.into_iter())
        .map(|(slot, (bundle, offset))| Page {
            bundle,
            offset,
            level: dag[slot].level,
            bytes: world.pages[slot].bytes.len(),
            lod_error: dag[slot].lod_error,
        })
        .collect();
    // Each HLOD cell holds the bundles of its roots.
    let mut hlod: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); tree.len()];
    for slot in (0..dag.len()).filter(|&slot| dag[slot].is_root()) {
        hlod[world.hlod(slot)].insert(laid.bundle_of[slot]);
    }
    let dag_bytes = encode_dag(world, &laid.at)?;
    // Each cell whose actor's build failed (`CHAIN_ACTOR_FAILED`): one built is one whose bundles
    // hold roots, which the table says already.
    let actors: Vec<u32> = (0..tree.len())
        .map(|cell| u32::from(failed.contains(&cell)) * CHAIN_ACTOR_FAILED)
        .collect();
    let table = encode_table(
        (&laid.bundles, &pages, (&hlod, tree, &actors)),
        &laid.payload,
    )?;
    let roots = dag.iter().filter(|c| c.is_root()).count();
    let report = json!({"version":WORLD_ROOTS_VERSION,"file":WORLD_ROOTS_FILE,
        "hlodCells":tree.iter().filter(|node| node.level == 0).count(),"chainCells":tree.len(),
        "builtCells":hlod.iter().filter(|h| !h.is_empty()).count(),
        "layers":world.cells.iter().map(|&cell| tree[cell].actor_level()).max(),
        "pages":pages.len(),"roots":roots,"bundles":laid.bundles.len(),
        "dependencyBound":laid.bound});
    Ok(Cooked {
        payload: laid.payload,
        table,
        dag: dag_bytes,
        report,
    })
}
