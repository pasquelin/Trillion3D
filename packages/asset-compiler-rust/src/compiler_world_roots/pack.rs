//! The world DAG in streaming bundles, packed and linked as a primitive's are (`pack_bundles`,
//! `compiler_bundle_dependencies.rs`): the top first, pinned, then the roots each cell holds, then
//! every level from the coarsest. The top is the roots several cells share; the roots one cell
//! alone needs (`top.rs`) lie in bundles of that cell's held roots alone, every level together,
//! which that cell depends on (`cells.rs`).
//! The object roots of level 0 are packed too, last, only to take their dependency lists: their
//! pages are the objects' own, never written twice.
//!
//! With `M` the materials and layouts the world wears, `N` its lone objects and `w` the bytes of
//! one copy: the pinned top is `Σ_M top bytes = O(M)`, whatever the objects, read at load and held
//! all session; the copies, `N·w` over the world, and every other root of one cell, are held only
//! with their cells, placed or far, `O(roots of the held cells)`, bounded by the plan's reach,
//! never by the world.
use super::cells::object_dependencies;
use super::merge::WorldDag;
use super::pages::encode_pages;
use super::table::{clusters, group_list};
use super::top::{held_by, refuse_over_budget};
use super::*;
use crate::compiler_primitive_bundle::index_bytes;
use crate::dag::build_culling_bvh;
use crate::geometry_page::Encoded;

/// Packs `world`, checks that every page reaches the pinned top or a root its cell holds, refuses a
/// top over `budget`, and returns the payload of the super-root bundles with the table that
/// describes them.
pub(super) fn pack_world(
    world: &WorldDag,
    instances: &[Instance],
    cells: usize,
    budget: usize,
) -> Result<Cooked> {
    let (dag, groups) = (&world.clusters, &world.groups);
    let encoded = encode_pages(world)?;
    let (order, _) = build_culling_bvh(&world.positions, dag);
    let bound = dependency_bound(dag, groups);
    // A super-root weighs its written page; a placed object, never written, its corners.
    let corners = index_bytes(dag);
    let weight = |slot: usize| {
        encoded[slot]
            .as_ref()
            .map_or_else(|| corners(slot), page_len)
    };
    // A root one cell alone needs closes its level in that cell's own bundles.
    let held_by = held_by(world)?;
    let held = |slot: usize| held_by[slot];
    let (bundles, pinned, bundle_of) = pack_bundles(dag, groups, &order, bound, (&weight, &held))?;
    let closed = close_dependencies(&direct_dependencies(dag, groups, &bundle_of, bundles.len()))?;
    verify_dependencies(dag, groups, &order, &bundle_of, &closed, pinned)?;
    // Level 0 is the placed objects alone, packed last: their bundles are never written.
    let written = bundles
        .iter()
        .position(|members| {
            members
                .iter()
                .all(|&rank| world.origins[order[rank]].is_some())
        })
        .unwrap_or(bundles.len());
    let (mut payload, mut records, mut pages, mut top) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    // Where each super-root's page lies in the binary, by world rank: what the `clusters` key
    // names for a runtime that builds its `DagRoot` pages.
    let mut located: Vec<Option<(usize, usize)>> = vec![None; dag.len()];
    for (index, members) in bundles.iter().enumerate().take(written) {
        let start = payload.len();
        for &rank in members {
            let (slot, offset) = (order[rank], payload.len());
            let (cluster, page) = (&dag[slot], written_page(&encoded, slot)?);
            payload.extend_from_slice(&page.bytes);
            if index < pinned {
                top.push((slot, page.bytes.len()));
            }
            located[slot] = Some((index, offset - start));
            let parent = cluster
                .parent_error
                .is_finite()
                .then_some(cluster.parent_error);
            pages.push(
                json!({"bundle":index,"offset":offset - start,"bytes":page.bytes.len(),
                "level":cluster.level,"material":world.materials[slot],"lodError":cluster.lod_error,
                "parentError":parent,"sphere":cluster.sphere,"parentSphere":cluster.parent_sphere}),
            );
        }
        let bytes = &payload[start..];
        records.push(
            json!({"offset":start,"bytes":bytes.len(),"sha256":hash(bytes),
            "count":members.len(),"dependencies":closed[index]}),
        );
    }
    let pinned_bytes: usize = top.iter().map(|(_, bytes)| bytes).sum();
    refuse_over_budget(world, &top, (pinned_bytes, budget))?;
    let (objects, ranks, outside) =
        object_dependencies(world, instances, &bundle_of, &closed, cells)?;
    let clusters = clusters((world, instances), (&located, &encoded), &ranks);
    let table = json!({"version":WORLD_ROOTS_VERSION,"budgetBytes":budget,"pinned":pinned,
        "pinnedTopBytes":pinned_bytes,"bundles":records,"pages":pages,"cells":objects,
        "clusters":clusters,"groups":group_list(&world.groups)});
    // The objects the world build placed nothing for are told by node: they draw their own pages.
    let report = json!({"version":WORLD_ROOTS_VERSION,"file":WORLD_ROOTS_FILE,"cells":cells,
        "superRoots":pages.len(),"topPages":top.len(),"pinnedBundles":pinned,
        "pinnedTopBytes":pinned_bytes,"budgetBytes":budget,"dependencyBound":bound,
        "outsideWorld":outside});
    Ok(Cooked {
        payload,
        table,
        report,
    })
}

/// A written page's length.
fn page_len(page: &Encoded) -> usize {
    page.bytes.len()
}

/// The page of super-root `slot`: every cluster of a written bundle is one.
fn written_page(encoded: &[Option<Encoded>], slot: usize) -> Result<&Encoded> {
    encoded[slot].as_ref().ok_or_else(|| {
        CompilerError::new(
            "INVALID_WORLD_ROOTS",
            format!("world cluster {slot} has no page in a written bundle"),
        )
    })
}
