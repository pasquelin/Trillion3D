//! The world DAG: the builds of `world.rs` — each cell's placed objects continued into its
//! super-roots, then the super-roots of every cell of a material and layout up to the world top —
//! spliced into one DAG per material and layout: a cell root the world build groups is the very
//! cluster its group names, never a copy.
use super::place::Roots;
use super::*;
use crate::dag::{DagCluster, DagGroup};
use crate::geometry_page::Attribute;
use crate::qem::compact_region;

/// Every cluster of the world, on one world-space vertex buffer and the attributes of `LAYOUT` on
/// it — each empty while no build carries it, zero on a vertex whose build does not. Level 0 is
/// the placed objects, each with its `origin`, the instance it places; every other cluster is a
/// super-root, written in its `layout`. `cells` names, per cluster, the cells it covers.
#[derive(Default)]
pub(super) struct WorldDag {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub materials: Vec<Option<u64>>,
    pub layouts: Vec<u32>,
    pub cells: Vec<Vec<usize>>,
    pub origins: Vec<Option<usize>>,
}

/// One build's key: its material and layout, and its cell when it is a cell's.
pub(super) type Key<'a> = (Option<u64>, u32, Option<usize>, &'a [usize]);

impl WorldDag {
    /// The vertices `clusters` use, on their own, with their attributes in `layout`, and the
    /// clusters on them: the world build of a material reads its cells' roots, not every vertex.
    pub(super) fn compact(
        &self,
        clusters: &[usize],
        layout: u32,
    ) -> (Vec<f32>, Vec<Attribute>, Roots) {
        let joined: Vec<u32> = clusters
            .iter()
            .flat_map(|&id| self.clusters[id].indices.iter().copied())
            .collect();
        let (positions, mut local, remap) = compact_region(&self.positions, &joined);
        let carried = (self.carried.iter())
            .filter(|a| layout & a.flag != 0)
            .map(|a| cover::compact_attribute(a, &remap))
            .collect();
        let mut roots = Vec::with_capacity(clusters.len());
        for &id in clusters.iter().rev() {
            let at = local.len() - self.clusters[id].indices.len();
            let cluster = &self.clusters[id];
            roots.push((local.split_off(at), cluster.lod_error, cluster.sphere));
        }
        roots.reverse();
        (positions, carried, roots)
    }

    /// Appends `vertices` of a build's `attributes` (its layout's) after the world's `before`.
    fn extend_attributes(&mut self, before: usize, vertices: usize, attributes: &[&Attribute]) {
        for target in &mut self.carried {
            match attributes.iter().find(|a| a.flag == target.flag) {
                Some(source) => {
                    target.values.resize(before * target.width, 0.0);
                    target
                        .values
                        .extend_from_slice(&source.values[..vertices * target.width]);
                }
                None if target.values.is_empty() => {}
                None => target
                    .values
                    .resize((before + vertices) * target.width, 0.0),
            }
        }
    }

    /// Appends one build on its own `arrays` and returns the world id of each of its clusters.
    /// `entered` are the world clusters its level 0 continues, in order: they take the links the
    /// build gave its level 0 instead of being copied.
    pub(super) fn splice(
        &mut self,
        (dag, groups): (Vec<DagCluster>, Vec<DagGroup>),
        (positions, attributes): (&[f32], &[&Attribute]),
        entered: &[usize],
        (material, layout, cell, origins): Key,
    ) -> Vec<usize> {
        let vertex_base = (self.positions.len() / 3) as u32;
        self.extend_attributes(vertex_base as usize, positions.len() / 3, attributes);
        self.positions.extend_from_slice(positions);
        let group_base = self.groups.len();
        let level_base = (entered.iter().map(|&id| self.clusters[id].level))
            .max()
            .unwrap_or(0);
        // The build's level 0 comes first: past `entered`, a cluster is pushed in slot order.
        let fresh = self.clusters.len();
        let ids: Vec<usize> = (0..dag.len())
            .map(|slot| (entered.get(slot).copied()).unwrap_or(fresh + slot - entered.len()))
            .collect();
        for (slot, mut cluster) in dag.into_iter().enumerate() {
            cluster.group = cluster.group.map(|g| g + group_base);
            cluster.source = cluster.source.map(|g| g + group_base);
            if let Some(&id) = entered.get(slot) {
                let target = &mut self.clusters[id];
                target.parent_error = cluster.parent_error;
                target.parent_sphere = cluster.parent_sphere;
                target.group = cluster.group;
                continue;
            }
            cluster.indices.iter_mut().for_each(|v| *v += vertex_base);
            if cluster.level > 0 {
                cluster.level += level_base;
            }
            self.push(
                cluster,
                (material, layout, cell, origins.get(slot).copied()),
            );
        }
        for mut group in groups {
            group.level += level_base;
            group.children.iter_mut().for_each(|c| *c = ids[*c]);
            group.outputs.iter_mut().for_each(|c| *c = ids[*c]);
            self.push_group(group);
        }
        ids
    }

    pub(super) fn push(&mut self, cluster: DagCluster, (material, layout, cell, origin): Placed) {
        self.clusters.push(cluster);
        self.materials.push(material);
        self.layouts.push(layout);
        self.cells.push(cell.into_iter().collect());
        self.origins.push(origin);
    }

    /// Appends `group`, its outputs covering the cells its children cover.
    pub(super) fn push_group(&mut self, group: DagGroup) {
        let mut covered: Vec<usize> = (group.children.iter())
            .flat_map(|&c| self.cells[c].iter().copied())
            .collect();
        covered.sort_unstable();
        covered.dedup();
        for &output in &group.outputs {
            self.cells[output] = covered.clone();
        }
        self.groups.push(group);
    }
}

/// A pushed cluster's material, layout, cell and origin.
pub(super) type Placed = (Option<u64>, u32, Option<usize>, Option<usize>);
