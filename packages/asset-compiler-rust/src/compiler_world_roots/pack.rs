//! The world DAG in streaming bundles, packed and linked as a primitive's are (`pack_bundles`,
//! `compiler_bundle_dependencies.rs`): the top first, pinned, then every level from the coarsest.
//! The object roots of level 0 are packed too, last, only to take their dependency lists: their
//! pages are the objects' own, never written twice.
use super::merge::WorldDag;
use super::*;
use crate::dag::{build_culling_bvh, DagCluster};

/// Bytes of one super-root page: vertex and triangle counts, its own vertices as three floats,
/// its triangles as 16-bit local indices, padded to four bytes.
fn page_bytes(cluster: &DagCluster) -> usize {
    let mut vertices = cluster.indices.clone();
    vertices.sort_unstable();
    vertices.dedup();
    8 + vertices.len() * 12 + (cluster.indices.len() * 2).next_multiple_of(4)
}

fn encode_page(cluster: &DagCluster, positions: &[f32], out: &mut Vec<u8>) {
    let mut local: Vec<u32> = Vec::new();
    let mut corners: Vec<u16> = Vec::with_capacity(cluster.indices.len());
    for &vertex in &cluster.indices {
        let at = local.iter().position(|&v| v == vertex).unwrap_or_else(|| {
            local.push(vertex);
            local.len() - 1
        });
        corners.push(at as u16);
    }
    out.extend((local.len() as u32).to_le_bytes());
    out.extend(((corners.len() / 3) as u32).to_le_bytes());
    for &vertex in &local {
        let at = vertex as usize * 3;
        positions[at..at + 3]
            .iter()
            .for_each(|v| out.extend(v.to_le_bytes()));
    }
    corners.iter().for_each(|c| out.extend(c.to_le_bytes()));
    out.resize(out.len().next_multiple_of(4), 0);
}

/// Refuses a pinned top over `budget`, naming the cell with the most pinned bytes over it: the
/// one whose roots did not reduce.
fn refuse_over_budget(world: &WorldDag, pinned: &[(usize, usize)], budget: usize) -> Result<()> {
    let total: usize = pinned.iter().map(|(_, bytes)| bytes).sum();
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
    let (bundles, pinned, bundle_of) = pack_bundles(dag, groups, &order, bound, &page_bytes)?;
    let closed = close_dependencies(&direct_dependencies(dag, groups, &bundle_of, bundles.len()))?;
    verify_dependencies(dag, groups, &order, &bundle_of, &closed, pinned)?;
    let object_page = |slot: usize| world.origins[slot].is_some() && !dag[slot].is_root();
    let written = bundles
        .iter()
        .position(|members| members.iter().all(|&rank| object_page(order[rank])))
        .unwrap_or(bundles.len());
    let (mut payload, mut records, mut pages, mut top) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (index, members) in bundles.iter().enumerate().take(written) {
        let start = payload.len();
        for &rank in members {
            let (slot, offset) = (order[rank], payload.len());
            let cluster = &dag[slot];
            encode_page(cluster, &world.positions, &mut payload);
            if index < pinned {
                top.push((slot, payload.len() - offset));
            }
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
    refuse_over_budget(world, &top, budget)?;
    let objects = object_dependencies(world, instances, &bundle_of, &closed, (pinned, cells))?;
    let pinned_bytes: usize = top.iter().map(|(_, bytes)| bytes).sum();
    let table = json!({"version":WORLD_ROOTS_VERSION,"budgetBytes":budget,"pinned":pinned,
        "pinnedTopBytes":pinned_bytes,"bundles":records,"pages":pages,"cells":objects});
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
/// bundle those roots need, up to the top. An object whose list misses the top is refused.
fn object_dependencies(
    world: &WorldDag,
    instances: &[Instance],
    bundle_of: &[usize],
    closed: &[Vec<usize>],
    (pinned, cells): (usize, usize),
) -> Result<Vec<Value>> {
    let mut needs: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); instances.len()];
    for (slot, origin) in world.origins.iter().enumerate() {
        let Some(origin) = origin else { continue };
        let cluster = &world.clusters[slot];
        let list = &mut needs[*origin];
        if cluster.is_root() {
            list.insert(bundle_of[slot]);
        }
        for &parent in parents_of(cluster, &world.groups) {
            list.insert(bundle_of[parent]);
            list.extend(&closed[bundle_of[parent]]);
        }
    }
    let mut table = vec![Vec::new(); cells];
    for (instance, needs) in instances.iter().zip(needs) {
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
        table[instance.cell].push(json!({"node":instance.node,"primitive":instance.primitive,
            "roots":roots,"dependencies":needs}));
    }
    Ok(table
        .into_iter()
        .map(|objects| json!({"objects":objects}))
        .collect())
}
