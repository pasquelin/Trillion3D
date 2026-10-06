//! The world DAG in streaming bundles, packed and linked as a primitive's are (`pack_bundles`,
//! `compiler_bundle_dependencies.rs`): the top first, pinned, then every level from the coarsest.
//! The object roots of level 0 are packed too, last, only to take their dependency lists: their
//! pages are the objects' own, never written twice.
use super::merge::WorldDag;
use super::table::{clusters, group_list};
use super::*;
use crate::dag::{build_culling_bvh, DagCluster};
use crate::geometry_page::localise;

/// Bytes of one super-root page: vertex and triangle counts, its own vertices as three floats in
/// world space, its triangles as 16-bit local indices, padded to four bytes.
fn page_bytes(vertices: usize, corners: usize) -> usize {
    8 + vertices * 12 + (corners * 2).next_multiple_of(4)
}

/// Writes one super-root page, its vertices renumbered as a primitive's page does (`localise`,
/// which refuses a page over 65,535 vertices).
fn encode_page(cluster: &DagCluster, positions: &[f32], out: &mut Vec<u8>) -> Result<()> {
    let (vertices, corners) = localise(&cluster.indices, positions.len() / 3)?;
    out.extend((vertices.len() as u32).to_le_bytes());
    out.extend(((corners.len() / 3) as u32).to_le_bytes());
    for &vertex in &vertices {
        let at = vertex as usize * 3;
        positions[at..at + 3]
            .iter()
            .for_each(|v| out.extend(v.to_le_bytes()));
    }
    corners
        .iter()
        .for_each(|&c| out.extend((c as u16).to_le_bytes()));
    out.resize(out.len().next_multiple_of(4), 0);
    Ok(())
}

/// Refuses a pinned top over `budget`, naming the cell with the most pinned bytes over it: the
/// one whose roots did not reduce.
fn refuse_over_budget(
    world: &WorldDag,
    pinned: &[(usize, usize)],
    (total, budget): (usize, usize),
) -> Result<()> {
    if total <= budget {
        return Ok(());
    }
    let mut per_cell: BTreeMap<usize, usize> = BTreeMap::new();
    for &(slot, bytes) in pinned {
        for &cell in &world.cells[slot] {
            *per_cell.entry(cell).or_default() += bytes;
        }
    }
    let (cell, bytes) = per_cell
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .unwrap_or_default();
    Err(CompilerError::new(
        "WORLD_TOP_OVER_BUDGET",
        format!(
            "The world's pinned top holds {total} bytes, over the budget of {budget}: cell {cell} \
             pins {bytes} of them"
        ),
    ))
}

/// Packs `world`, checks that every page reaches the pinned top, refuses a top over `budget`,
/// and returns the payload of the super-root bundles with the table that describes them.
pub(super) fn pack_world(
    world: &WorldDag,
    instances: &[Instance],
    cells: usize,
    budget: usize,
) -> Result<Cooked> {
    let (dag, groups) = (&world.clusters, &world.groups);
    let (order, _) = build_culling_bvh(&world.positions, dag);
    let bound = dependency_bound(dag, groups);
    let weight = |cluster: &DagCluster| {
        let vertices = localise(&cluster.indices, usize::MAX).map_or(0, |(v, _)| v.len());
        page_bytes(vertices, cluster.indices.len())
    };
    let (bundles, pinned, bundle_of) = pack_bundles(dag, groups, &order, bound, &weight)?;
    let closed = close_dependencies(&direct_dependencies(dag, groups, &bundle_of, bundles.len()))?;
    verify_dependencies(dag, groups, &order, &bundle_of, &closed, pinned)?;
    let object_page = |slot: usize| world.origins[slot].is_some() && !dag[slot].is_root();
    let written = bundles
        .iter()
        .position(|members| members.iter().all(|&rank| object_page(order[rank])))
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
            let cluster = &dag[slot];
            encode_page(cluster, &world.positions, &mut payload)?;
            if index < pinned {
                top.push((slot, payload.len() - offset));
            }
            located[slot] = Some((index, offset - start));
            let parent = cluster
                .parent_error
                .is_finite()
                .then_some(cluster.parent_error);
            pages.push(
                json!({"bundle":index,"offset":offset - start,"level":cluster.level,
                "material":world.materials[slot],"lodError":cluster.lod_error,
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
    let (objects, ranks) =
        object_dependencies(world, instances, &bundle_of, &closed, (pinned, cells))?;
    let clusters = clusters(dag, world, &located, &ranks);
    let table = json!({"version":WORLD_ROOTS_VERSION,"budgetBytes":budget,"pinned":pinned,
        "pinnedTopBytes":pinned_bytes,"bundles":records,"pages":pages,"cells":objects,
        "clusters":clusters,"groups":group_list(&world.groups)});
    let report = json!({"version":WORLD_ROOTS_VERSION,"file":WORLD_ROOTS_FILE,"cells":cells,
        "superRoots":pages.len(),"topPages":top.len(),"pinnedBundles":pinned,
        "pinnedTopBytes":pinned_bytes,"budgetBytes":budget,"dependencyBound":bound});
    Ok(Cooked {
        payload,
        table,
        report,
    })
}

/// Per cell, each placed object's primitive: the bundles holding its own roots, and every world
/// bundle those roots need, up to the top. An object whose list misses the top is refused. With
/// them, each instance's rank among the table's objects, cell after cell (`None` for an instance
/// whose primitive has no root cover): the `origin` an object root names.
fn object_dependencies(
    world: &WorldDag,
    instances: &[Instance],
    bundle_of: &[usize],
    closed: &[Vec<usize>],
    (pinned, cells): (usize, usize),
) -> Result<(Vec<Value>, Vec<Option<usize>>)> {
    // Per instance, the bundles holding its roots that stay roots, and the distinct bundles of
    // their parents: each parent's closed list is then added once, not once per root sharing it.
    let mut own: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); instances.len()];
    let mut parents: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); instances.len()];
    for (slot, origin) in world.origins.iter().enumerate() {
        let Some(origin) = *origin else { continue };
        let cluster = &world.clusters[slot];
        if cluster.is_root() {
            own[origin].insert(bundle_of[slot]);
        }
        let above = parents_of(cluster, &world.groups).iter();
        parents[origin].extend(above.map(|&parent| bundle_of[parent]));
    }
    let needs = own.into_iter().zip(parents).map(|(mut all, parents)| {
        parents
            .iter()
            .for_each(|&bundle| all.extend(&closed[bundle]));
        all.extend(parents);
        all
    });
    let mut table = vec![Vec::new(); cells];
    let mut in_cell = vec![None; instances.len()];
    for ((instance, needs), at) in instances.iter().zip(needs).zip(&mut in_cell) {
        if instance.cover.clusters.is_empty() {
            continue;
        }
        if needs.first().is_none_or(|&first| first >= pinned) {
            return Err(CompilerError::new(
                "INVALID_PAGE_DEPENDENCIES",
                format!(
                    "Node {} (primitive {}) in cell {} does not reach the world top",
                    instance.node, instance.primitive, instance.cell
                ),
            ));
        }
        let mut roots: Vec<usize> = instance.cover.clusters.iter().map(|c| c.bundle).collect();
        roots.sort_unstable();
        roots.dedup();
        *at = Some(table[instance.cell].len());
        table[instance.cell].push(json!({"node":instance.node,"primitive":instance.primitive,
            "roots":roots,"dependencies":needs}));
    }
    // Each cell's first rank: its objects follow the cells before it.
    let mut first = vec![0; cells];
    (1..cells).for_each(|cell| first[cell] = first[cell - 1] + table[cell - 1].len());
    let ranks = in_cell
        .into_iter()
        .zip(instances)
        .map(|(at, instance)| at.map(|at| first[instance.cell] + at))
        .collect();
    let table = table.into_iter().map(|objects| json!({"objects":objects}));
    Ok((table.collect(), ranks))
}
