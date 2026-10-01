//! The `clusters` and `groups` of the world roots (#1238), written as `world-roots.dag`: the
//! per-cluster metadata the runtime's cut projects, for every world cluster — object roots
//! included — and the group list.
use super::merge::WorldDag;
use super::*;
use crate::dag::bounds::cluster_bounds;
use crate::dag::{DagCluster, DagGroup};

/// The per-cluster metadata the runtime's cut projects, for every world cluster — object roots
/// included — named by its world rank, the same rank its group's `children` and `outputs` use. A
/// super-root names its page's place in the binary (`bundle`, `offset`); an object root names its
/// `origin`, the placed object of the table that draws it (`object_of` its instance, #1332), and
/// keeps its own page in the primitive's streams.
pub(super) fn clusters(
    dag: &[DagCluster],
    world: &WorldDag,
    (located, object_of): (&[Option<(usize, usize)>], &[Option<usize>]),
) -> Vec<Value> {
    (0..dag.len())
        .map(|slot| {
            let cluster = &dag[slot];
            let (min, max) = cluster_bounds(&world.positions, &cluster.indices);
            let finite = cluster.parent_error.is_finite();
            let (parent, parent_sphere) = (
                finite.then_some(cluster.parent_error),
                finite.then_some(cluster.parent_sphere),
            );
            let (bundle, offset) = located[slot].map_or((None, None), |(b, o)| (Some(b), Some(o)));
            json!({"cluster":slot,"level":cluster.level,"lodError":cluster.lod_error,
                "sphere":cluster.sphere,"parentError":parent,"parentSphere":parent_sphere,
                "min":min,"max":max,"triangles":cluster.triangles(),
                "material":world.materials[slot],"bundle":bundle,"offset":offset,
                "origin":world.origins[slot].and_then(|instance| object_of[instance])})
        })
        .collect()
}

/// Each instance's rank among the table's objects — cell after cell, an instance whose primitive has
/// no root cover listing none —, so a runtime finds an object root's cell and placement from its
/// `origin` (#1332).
pub(super) fn object_ranks(instances: &[Instance], cells: usize) -> Vec<Option<usize>> {
    let covered = |i: &&Instance| !i.cover.clusters.is_empty();
    // Each cell's first object, then the next free rank in it as its instances are met in order.
    let mut next = vec![0; cells + 1];
    for instance in instances.iter().filter(covered) {
        next[instance.cell + 1] += 1;
    }
    (0..cells).for_each(|cell| next[cell + 1] += next[cell]);
    let mut rank = |cell: usize| (next[cell], next[cell] += 1).0;
    instances
        .iter()
        .map(|i| covered(&i).then(|| rank(i.cell)))
        .collect()
}

/// The group list, each naming its children and outputs by world rank, with its error band and
/// sphere: the relation the runtime's `structureIndex` flattens into its `ClusterStructureIndex`.
pub(super) fn group_list(groups: &[DagGroup]) -> Vec<Value> {
    groups
        .iter()
        .map(|group| {
            json!({"level":group.level,"error":group.error,"sphere":group.sphere,
                "children":group.children,"outputs":group.outputs})
        })
        .collect()
}
