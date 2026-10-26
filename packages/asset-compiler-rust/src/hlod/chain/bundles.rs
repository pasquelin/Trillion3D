//! The world DAG in streaming pages (`compiler/pages/bundles.rs`), linked by
//! `compiler/pages/dependencies.rs`: nothing pinned — each actor is a cover of its own, assigned as
//! one resource, its root pages its HLOD cell's, held while its actor is loaded: an HLOD actor
//! streams with its own cell, so its pages come and go with that cell's range alone —, each page
//! needing its parents' up to its cell's root pages.
use super::dag_records::encode_dag;
use super::merge::WorldDag;
use super::records::{encode_table, Page};
use super::*;
use crate::compiler::pages::bundles::{lay_bundles, root_page_count, Laying};
use crate::compiler::tables::partition::HlodNode;

/// How `world`'s pages are assigned and laid (`Laying`), handed to `with`: every slot of an actor
/// its HLOD cell's — the cell holds the actor's root pages —, each actor keeping the root pages its
/// layer's always-resident size asks, one at least (`HlodLayer::mesh_build`, `alwaysResidentKib`:
/// the reference's default, `DEFAULT_ALWAYS_RESIDENT_KIB`, where it names none), `tree` the
/// partition's chain of HLOD cells, built by the layers of `options`. World pages are in world
/// space: their bands are in metres already. The one laying the assignment
/// (`WorldDag::in_culling_order`) and the layout (`pack_world`) read.
pub(super) fn with_world_laying<T>(
    world: &WorldDag,
    (tree, options): (&[HlodNode], &crate::Hlod),
    with: impl FnOnce(&Laying) -> T,
) -> T {
    // Each cell's actor's root pages, by the layer that builds it.
    let root_pages = |cell: Option<usize>| {
        let layer = cell.and_then(|cell| tree[cell].actor);
        layer.map_or(root_page_count(DEFAULT_ALWAYS_RESIDENT_KIB), |layer| {
            options.layers[layer].mesh_build.root_pages
        })
    };
    let held = |slot: usize| Some(world.hlod(slot));
    with(&Laying {
        positions: &world.positions,
        held: &held,
        root_pages: &root_pages,
        scale: 1.0,
    })
}

/// Lays `world`'s pages as they were assigned (`WorldDag::in_culling_order`, `lay_bundles`: every
/// page reaches its HLOD cell's root pages), and returns the payload of the pages with the table and
/// the DAG records that describe them, written straight from the world (`records.rs`). A cell whose
/// actor could not be made holds no page: its actor stands for nothing.
pub(super) fn pack_world(
    world: &mut WorldDag,
    (tree, rows): (&[HlodNode], &[Vec<super::builds::ActorRow>]),
    options: &crate::Hlod,
) -> Result<Cooked> {
    let assigned = (world.assigned.take()).expect("the world in its culling order");
    let world = &*world;
    let (dag, groups) = (&world.clusters, &world.groups);
    // The world lies in its culling order already (`WorldDag::in_culling_order`): rank is slot.
    let pages: Vec<&[u8]> = world
        .pages
        .iter()
        .map(|page| page.bytes.as_slice())
        .collect();
    let mut laid = with_world_laying(world, (tree, options), |laying| {
        lay_bundles((dag, groups), &pages, (assigned, laying))
    })?;
    // Each page in the binary's order, by its streaming page and its offset there.
    let mut written: Vec<(usize, (usize, usize))> = laid.at.iter().copied().enumerate().collect();
    written.sort_unstable_by_key(|&(_, at)| at);
    let pages: Vec<Page> = (written.into_iter())
        .map(|(slot, (bundle, offset))| Page {
            bundle,
            offset,
            level: dag[slot].level,
            bytes: laid.lengths[slot],
            lod_error: dag[slot].lod_error,
        })
        .collect();
    // Each HLOD cell holds its actor's root pages.
    let mut hlod: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); tree.len()];
    for (slot, &page) in laid.bundle_of.iter().enumerate() {
        if laid.root[page] {
            hlod[world.hlod(slot)].insert(page);
        }
    }
    // And its actor's rows, one bundle after the pages: they stream with the actor.
    let rows = super::builds::lay_rows(rows, (&mut laid.payload, &mut laid.bundles), &mut hlod)?;
    let dag_bytes = encode_dag(world, (&laid.at, &laid.resident, &laid.lengths))?;
    let table = encode_table((&laid.bundles, &pages, (&hlod, tree, &rows)), &laid.payload)?;
    let roots = dag.iter().filter(|c| c.is_root()).count();
    let report = json!({"version":WORLD_ROOTS_VERSION,"file":WORLD_ROOTS_FILE,
        "hlodCells":tree.iter().filter(|node| node.level == 0).count(),"chainCells":tree.len(),
        "builtCells":hlod.iter().filter(|h| !h.is_empty()).count(),
        "layers":world.cells.iter().map(|&cell| tree[cell].actor_level).max(),
        "pages":pages.len(),"roots":roots,"bundles":laid.bundles.len(),
        "dependencyBound":laid.bound});
    Ok(Cooked {
        payload: laid.payload,
        table,
        dag: dag_bytes,
        report,
    })
}
