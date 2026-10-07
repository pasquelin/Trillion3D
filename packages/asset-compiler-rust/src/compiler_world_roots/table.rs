//! The `clusters` and `groups` of the world roots, written as `world-roots.dag`: the
//! per-cluster metadata the runtime's cut projects, for every world cluster — object roots
//! included — and the group list.
use super::merge::WorldDag;
use super::pages::page_facts;
use super::*;
use crate::dag::bounds::cluster_bounds;
use crate::dag::DagGroup;
use crate::geometry_page::Encoded;

/// Where each super-root's page lies in the binary, and the page itself; none for a placed object.
type Pages<'a> = (&'a [Option<(usize, usize)>], &'a [Option<Encoded>]);

/// The per-cluster metadata the runtime's cut projects, for every world cluster — placed objects
/// included — named by its world rank, the same rank its group's `children` and `outputs` use. A
/// super-root names its page's place in the binary (`bundle`, `offset`) and what its geometry
/// descriptor reads of it (`page_facts`); each the primitive it wears (`wearer`); a placed object
/// names its `origin`, the placed object of the table that draws it (`object_of` its instance, its
/// rank `object_dependencies` gives), and keeps its own pages in the primitive's streams.
pub(super) fn clusters(
    (world, instances): (&WorldDag, &[Instance]),
    (located, encoded): Pages,
    object_of: &[Option<usize>],
) -> Vec<Value> {
    (0..world.clusters.len())
        .map(|slot| {
            let cluster = &world.clusters[slot];
            let (min, max) = cluster_bounds(&world.positions, &cluster.indices);
            let finite = cluster.parent_error.is_finite();
            let (parent, parent_sphere) = (
                finite.then_some(cluster.parent_error),
                finite.then_some(cluster.parent_sphere),
            );
            let (bundle, offset) = located[slot].map_or((None, None), |(b, o)| (Some(b), Some(o)));
            let mut record = json!({"cluster":slot,"level":cluster.level,"lodError":cluster.lod_error,
                "sphere":cluster.sphere,"parentError":parent,"parentSphere":parent_sphere,
                "min":min,"max":max,"triangles":cluster.triangles(),
                "primitive":wearer(world, instances, slot),"bundle":bundle,"offset":offset,
                "origin":world.origins[slot].and_then(|instance| object_of[instance])});
            if let Some(page) = &encoded[slot] {
                record["page"] = page_facts(page);
            }
            record
        })
        .collect()
}

/// The primitive whose material and attribute layout world cluster `slot` wears: its own object's,
/// or for a super-root the first object it descends from — every object of its build wears the
/// same (`world.rs`). The runtime draws a super-root in that primitive's material.
fn wearer(world: &WorldDag, instances: &[Instance], mut slot: usize) -> Option<usize> {
    loop {
        if let Some(instance) = world.origins[slot] {
            return Some(instances[instance].primitive);
        }
        slot = world.groups[world.clusters[slot].source?].children[0];
    }
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
