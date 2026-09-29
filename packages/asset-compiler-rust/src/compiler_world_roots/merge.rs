//! The world DAG: the object roots of each cell and material continued by the DAG builder into
//! the cell's super-roots, then the super-roots of every cell of a material continued the same
//! way up to the world top. The two builds are spliced into one DAG per material: a cell root the
//! world build groups is the very cluster its group names, never a copy.
use super::*;
use crate::compiler_world::transform_point;
use crate::dag::{build_dag_from_roots, DagCluster, DagGroup};
use crate::proxy::world_scale;
use std::collections::HashMap;

/// Every cluster of the world, on one world-space vertex buffer. Level 0 is the object roots,
/// each with its `origin`, the instance it places; every other cluster is a super-root. `cells` names, per cluster, the
/// cells it covers.
#[derive(Default)]
pub(super) struct WorldDag {
    pub positions: Vec<f32>,
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub materials: Vec<Option<u64>>,
    pub cells: Vec<Vec<usize>>,
    pub origins: Vec<Option<usize>>,
}

/// Root clusters as the builder takes them: triangles, and the error each was published at.
type Roots = Vec<(Vec<u32>, f64)>;

/// The object roots of `members` placed in world space: positions, clusters with their error in
/// world units, and the instance each comes from.
fn gather(instances: &[Instance], members: &[usize]) -> (Vec<f32>, Roots, Vec<usize>) {
    let (mut positions, mut roots, mut origins) = (Vec::new(), Vec::new(), Vec::new());
    for &instance in members {
        let placed = &instances[instance];
        let base = (positions.len() / 3) as u32;
        for vertex in placed.cover.positions.as_chunks::<3>().0 {
            let point = [vertex[0], vertex[1], vertex[2]].map(f64::from);
            positions.extend(transform_point(&placed.matrix, point).map(|v| v as f32));
        }
        let scale = world_scale(&placed.matrix);
        for root in &placed.cover.clusters {
            roots.push((
                root.indices.iter().map(|&v| v + base).collect(),
                root.error * scale,
            ));
            origins.push(instance);
        }
    }
    (positions, roots, origins)
}

impl WorldDag {
    /// The vertices `clusters` use, on their own, and the clusters on them: the world build of a
    /// material reads its cells' roots, not every vertex of the world.
    fn compact(&self, clusters: &[usize]) -> (Vec<f32>, Roots) {
        let (mut positions, mut local) = (Vec::new(), HashMap::new());
        let mut roots = Vec::with_capacity(clusters.len());
        for &id in clusters {
            let cluster = &self.clusters[id];
            let mut indices = Vec::with_capacity(cluster.indices.len());
            for &vertex in &cluster.indices {
                let next = (positions.len() / 3) as u32;
                indices.push(*local.entry(vertex).or_insert_with(|| {
                    let at = vertex as usize * 3;
                    positions.extend_from_slice(&self.positions[at..at + 3]);
                    next
                }));
            }
            roots.push((indices, cluster.lod_error));
        }
        (positions, roots)
    }

    /// Appends one build on its own `positions` and returns the world id of each of its clusters. `entered` are the world clusters its level 0 continues,
    /// in order: they take the links the build gave its level 0 instead of being copied.
    fn splice(
        &mut self,
        (dag, groups): (Vec<DagCluster>, Vec<DagGroup>),
        positions: &[f32],
        entered: &[usize],
        (material, cell, origins): (Option<u64>, Option<usize>, &[usize]),
    ) -> Vec<usize> {
        let vertex_base = (self.positions.len() / 3) as u32;
        self.positions.extend_from_slice(positions);
        let group_base = self.groups.len();
        let level_base = entered
            .iter()
            .map(|&id| self.clusters[id].level)
            .max()
            .unwrap_or(0);
        // The build's level 0 comes first: past `entered`, a cluster is pushed in slot order.
        let fresh = self.clusters.len();
        let ids: Vec<usize> = (0..dag.len())
            .map(|slot| {
                entered
                    .get(slot)
                    .copied()
                    .unwrap_or(fresh + slot - entered.len())
            })
            .collect();
        for (slot, mut cluster) in dag.into_iter().enumerate() {
            cluster.group = cluster.group.map(|g| g + group_base);
            cluster.source = cluster.source.map(|g| g + group_base);
            cluster.replacement = cluster.replacement.map(|r| ids[r]);
            if let Some(&id) = entered.get(slot) {
                let target = &mut self.clusters[id];
                target.parent_error = cluster.parent_error;
                target.parent_sphere = cluster.parent_sphere;
                target.group = cluster.group;
                target.replacement = cluster.replacement;
                continue;
            }
            cluster.indices.iter_mut().for_each(|v| *v += vertex_base);
            if cluster.level > 0 {
                cluster.level += level_base;
            }
            self.clusters.push(cluster);
            self.materials.push(material);
            self.cells.push(cell.into_iter().collect());
            self.origins.push(origins.get(slot).copied());
        }
        for mut group in groups {
            group.level += level_base;
            group.children.iter_mut().for_each(|c| *c = ids[*c]);
            group.outputs.iter_mut().for_each(|c| *c = ids[*c]);
            let mut covered: Vec<usize> = group
                .children
                .iter()
                .flat_map(|&c| self.cells[c].clone())
                .collect();
            covered.sort_unstable();
            covered.dedup();
            for &output in &group.outputs {
                self.cells[output] = covered.clone();
            }
            self.groups.push(group);
        }
        ids
    }
}

/// The world DAG of `instances`: per cell and material, their object roots continued into the
/// cell's super-roots; per material, the super-roots of all its cells continued to the top.
pub(super) fn world_dag(
    instances: &[Instance],
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<WorldDag> {
    let mut keyed: BTreeMap<(Option<u64>, usize), Vec<usize>> = BTreeMap::new();
    for (index, instance) in instances.iter().enumerate() {
        if !instance.cover.clusters.is_empty() {
            keyed
                .entry((instance.material, instance.cell))
                .or_default()
                .push(index);
        }
    }
    let keyed: Vec<_> = keyed.into_iter().collect();
    let cells: Vec<_> = keyed
        .into_par_iter()
        .map(|((material, cell), members)| {
            let (positions, roots, origins) = gather(instances, &members);
            let built = build_dag_from_roots(&positions, roots, checkpoint)?;
            Ok((material, cell, positions, origins, (built.0, built.1)))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut world = WorldDag::default();
    let mut tops: BTreeMap<Option<u64>, Vec<usize>> = BTreeMap::new();
    for (material, cell, positions, origins, built) in cells {
        let key = (material, Some(cell), &origins[..]);
        let ids = world.splice(built, &positions, &[], key);
        let roots = ids.into_iter().filter(|&id| world.clusters[id].is_root());
        tops.entry(material).or_default().extend(roots);
    }
    for (material, entered) in tops {
        let (positions, roots) = world.compact(&entered);
        let built = build_dag_from_roots(&positions, roots, checkpoint)?;
        world.splice(
            (built.0, built.1),
            &positions,
            &entered,
            (material, None, &[]),
        );
    }
    Ok(world)
}
