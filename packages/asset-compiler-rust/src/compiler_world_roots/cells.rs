//! The placed objects of each cell and the world bundles they need (`cells` of the table): what a
//! cell holds while it is placed or far. A root one cell alone needs (`top.rs`) is packed past the
//! pinned top in bundles of that cell's held roots alone: its bundle is on its own objects' lists,
//! so its cell holds it and no other cell pays for it.
use super::merge::WorldDag;
use super::*;

/// Per instance, every world bundle its world clusters need — the bundles of their parents and all
/// they need, each parent's list added once however many clusters share it —, `None` for an
/// instance the world build placed no cluster for. No placed cluster is a root (`stand_alone`).
fn needs_of(
    world: &WorldDag,
    bundle_of: &[usize],
    closed: &[Vec<usize>],
    instances: usize,
) -> Vec<Option<BTreeSet<usize>>> {
    let mut needs: Vec<Option<BTreeSet<usize>>> = vec![None; instances];
    for (slot, origin) in world.origins.iter().enumerate() {
        let Some(origin) = *origin else { continue };
        let need = needs[origin].get_or_insert_with(BTreeSet::new);
        for &parent in parents_of(&world.clusters[slot], &world.groups) {
            // A bundle listed already came with its list, or on a list, which holds its own.
            if need.insert(bundle_of[parent]) {
                need.extend(&closed[bundle_of[parent]]);
            }
        }
    }
    needs
}

/// The table's objects of each cell, each instance's rank among them, and the instances with a
/// cover the world build placed no cluster for, which ship with their own pages alone.
type Objects = (Vec<Value>, Vec<Option<usize>>, Vec<usize>);

/// Per cell, each placed object's primitive: the bundles holding its own roots, and every world
/// bundle those roots need, up to the top or a root its cell holds (`verify_dependencies` checked
/// every list ends there). An object the world build placed that needs none has nothing standing in for it
/// far away, and is refused; one it placed nothing for ships with its own pages, as an object
/// without a cover does, and is told. With them, each instance's rank among the table's objects,
/// cell after cell (`None` for an instance outside the table): the `origin` an object root names.
pub(super) fn object_dependencies(
    world: &WorldDag,
    instances: &[Instance],
    bundle_of: &[usize],
    closed: &[Vec<usize>],
    cells: usize,
) -> Result<Objects> {
    let needs = needs_of(world, bundle_of, closed, instances.len());
    let (mut table, mut outside) = (vec![Vec::new(); cells], Vec::new());
    // Per cell, each node's first object, by the node's rank in the cell: one a node the world
    // build placed nothing for, or whose mesh holds no cover, never has.
    let mut nodes: Vec<Vec<Option<usize>>> = vec![Vec::new(); cells];
    let mut in_cell = vec![None; instances.len()];
    for ((instance, needs), at) in instances.iter().zip(needs).zip(&mut in_cell) {
        if instance.cover.clusters.is_empty() {
            continue;
        }
        let Some(needs) = needs else {
            outside.push(instance.node);
            continue;
        };
        if needs.is_empty() {
            return Err(CompilerError::new(
                "INVALID_PAGE_DEPENDENCIES",
                format!(
                    "Node {} (primitive {}) in cell {} has no world stand-in",
                    instance.node, instance.primitive, instance.cell
                ),
            ));
        }
        let mut roots: Vec<usize> = instance.cover.clusters.iter().map(|c| c.bundle).collect();
        roots.sort_unstable();
        roots.dedup();
        *at = Some(table[instance.cell].len());
        let firsts = &mut nodes[instance.cell];
        if firsts.len() <= instance.slot {
            firsts.resize(instance.slot + 1, None);
        }
        firsts[instance.slot].get_or_insert(table[instance.cell].len());
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
    let table = table
        .into_iter()
        .zip(nodes)
        .map(|(objects, nodes)| json!({"objects":objects,"nodes":nodes}));
    Ok((table.collect(), ranks, outside))
}
