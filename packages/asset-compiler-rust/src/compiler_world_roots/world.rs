//! The world builds (`merge.rs` splices them): per cell, material and attribute layout, its placed
//! objects continued into the cell's super-roots; per material and layout, the super-roots of all
//! its cells continued to the top. An object nothing grouped is given a parent of its own
//! (`stand_alone`): every placed object has a world parent that stands in for it.
use super::merge::WorldDag;
use super::place::{empty, gather, layout_of, Roots, LAYOUT};
use super::*;
use crate::dag::clusters::cluster_triangles;
use crate::dag::{
    build_dag_from_roots, DagAttributes, DagCluster, DagGroup, Grown, DAG_CLUSTER_TRIANGLES,
};
use crate::geometry_page::Attribute;

impl WorldDag {
    /// Every placed object still a root — alone in its material, or in a group whose reduction
    /// stalled — gets a group of its own whose outputs are a copy of it, cut into clusters a page
    /// holds (`DAG_CLUSTER_TRIANGLES`), at its error and sphere: its placement then always has a
    /// world parent, which the cut compares as it compares any parent (`drawsCluster`), and the
    /// copy is the pages that stand in for it far away. The copy is a root of the world that only
    /// its cell needs: packed with its cell's content, never in the pinned top (`top.rs`).
    fn stand_alone(&mut self) -> Result<()> {
        let lone: Vec<usize> = (0..self.clusters.len())
            .filter(|&id| self.origins[id].is_some() && self.clusters[id].is_root())
            .collect();
        for id in lone {
            let group = self.groups.len();
            let child = &mut self.clusters[id];
            (child.parent_error, child.parent_sphere) = (child.lod_error, child.sphere);
            child.group = Some(group);
            let (error, sphere, level) = (child.lod_error, child.sphere, child.level + 1);
            let parts = cluster_triangles(&self.positions, &child.indices, DAG_CLUSTER_TRIANGLES)?;
            let (material, layout) = (self.materials[id], self.layouts[id]);
            let mut outputs = Vec::with_capacity(parts.len());
            for indices in parts {
                let mut copy = self.clusters[id].clone();
                (copy.indices, copy.level, copy.source, copy.group) =
                    (indices, level, Some(group), None);
                (copy.parent_error, copy.parent_sphere) = (f64::INFINITY, sphere);
                self.push(copy, (material, layout, None, None));
                outputs.push(self.clusters.len() - 1);
            }
            let children = vec![id];
            self.push_group(DagGroup {
                level,
                error,
                sphere,
                children,
                outputs,
            });
        }
        Ok(())
    }
}

/// A world build: its clusters and groups, and the positions and attributes they index.
type Built = ((Vec<DagCluster>, Vec<DagGroup>), Vec<f32>, Vec<Attribute>);

/// One world build of `roots` on `positions` and `carried`: the DAG, its groups and the arrays its
/// clusters index — the input's, or those a seam-locked solve grew (`Grown`).
fn build(
    positions: Vec<f32>,
    carried: Vec<Attribute>,
    roots: Roots,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Built> {
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let (dag, groups, .., grown) = build_dag_from_roots(&positions, attributes, roots, checkpoint)?;
    Ok(match grown {
        Some(Grown {
            positions, carried, ..
        }) => ((dag, groups), positions, carried),
        None => ((dag, groups), positions, carried),
    })
}

/// The world DAG of `instances`: per cell, material and layout, their objects continued into the
/// cell's super-roots; per material and layout, the super-roots of all its cells to the top.
pub(super) fn world_dag(
    instances: &[Instance],
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<WorldDag> {
    let mut keyed: BTreeMap<(Option<u64>, u32, usize), Vec<usize>> = BTreeMap::new();
    for (index, instance) in instances.iter().enumerate() {
        if !instance.cover.clusters.is_empty() {
            let key = (instance.material, layout_of(instance.cover), instance.cell);
            keyed.entry(key).or_default().push(index);
        }
    }
    let cells = (keyed.into_iter().collect::<Vec<_>>().into_par_iter())
        .map(|((material, layout, cell), members)| {
            let (positions, carried, roots, origins) = gather(instances, &members, layout);
            let built = build(positions, carried, roots, checkpoint)?;
            Ok(((material, layout, cell), origins, built))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut world = WorldDag {
        carried: empty(LAYOUT.iter().fold(0, |all, (flag, _)| all | flag)),
        ..WorldDag::default()
    };
    let mut tops: BTreeMap<(Option<u64>, u32), Vec<usize>> = BTreeMap::new();
    for ((material, layout, cell), origins, (dag, positions, carried)) in cells {
        let arrays: Vec<&Attribute> = carried.iter().collect();
        let key = (material, layout, Some(cell), &origins[..]);
        let ids = world.splice(dag, (&positions, &arrays), &[], key);
        let roots = ids.into_iter().filter(|&id| world.clusters[id].is_root());
        tops.entry((material, layout)).or_default().extend(roots);
    }
    // Each material's top is built on its own: in parallel, then spliced in material order.
    let tops: Vec<_> = (tops.into_iter())
        .map(|(key, entered)| (key, world.compact(&entered, key.1), entered))
        .collect();
    let built = (tops.into_par_iter())
        .map(|(key, (positions, carried, roots), entered)| {
            Ok((key, entered, build(positions, carried, roots, checkpoint)?))
        })
        .collect::<Result<Vec<_>>>()?;
    for ((material, layout), entered, (dag, positions, carried)) in built {
        let arrays: Vec<&Attribute> = carried.iter().collect();
        world.splice(
            dag,
            (&positions, &arrays),
            &entered,
            (material, layout, None, &[]),
        );
    }
    world.stand_alone()?;
    let vertices = world.positions.len() / 3;
    for attribute in world.carried.iter_mut().filter(|a| !a.values.is_empty()) {
        attribute.values.resize(vertices * attribute.width, 0.0);
    }
    Ok(world)
}
